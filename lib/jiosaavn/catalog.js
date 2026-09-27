import { httpErrors } from '@fastify/sensible';

import { fold } from '../text.js';

import { trackView } from './map.js';

const SEARCH_TIMEOUT_MS = 3500;
/** The most results JioSaavn returns for one search call (a larger `n` is silently cut to this). */
const UPSTREAM_PAGE = 40;
const DAY = 24 * 3600;
const SEARCH_TTL_SEC = 3600;
/** When upstream calls failed (timeout, network, ...), the empty-ish result is cached only briefly, so a
 *  transient outage self-heals instead of showing "no results" for the full hour. */
const SEARCH_FAILURE_TTL_SEC = 30;

/**
 * Search and lookups of tracks, albums, artists and playlists. Every result comes from JioSaavn and is
 * cached in Redis; nothing is stored anywhere else.
 */
export class Catalog {
  jiosaavn;
  cache;

  constructor(jiosaavn, cache) {
    this.jiosaavn = jiosaavn;
    this.cache = cache;
  }

  // ---- search -----------------------------------------------------------------------------------

  async search(query, types, limit, offset) {
    const q = query.trim().replace(/\s+/g, ' ');
    if (!q) throw httpErrors.badRequest('Query must not be empty');
    const typeKey = [...types].sort().join(',');

    return this.cache.wrap(
      `search:v5:${typeKey}:${fold(q)}:${limit}:${offset}`,
      (result) => (result.failed ? SEARCH_FAILURE_TTL_SEC : SEARCH_TTL_SEC),
      async () => {
        const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
        // The window is the first offset + limit + 1 results: the extra one is how we know there is a next page.
        // JioSaavn returns at most UPSTREAM_PAGE per call but has many pages, so build the window from as many as needed.
        const pages = Math.ceil((limit + offset + 1) / UPSTREAM_PAGE);
        const parts = await Promise.all(
          Array.from({ length: pages }, (_, i) =>
            this.jiosaavn.search(q, types, { signal, limit: UPSTREAM_PAGE, page: i + 1 }),
          ),
        );
        const failed = parts.some((p) => p.failed);
        const res = {
          tracks: parts.flatMap((p) => p.tracks ?? []),
          albums: parts.flatMap((p) => p.albums ?? []),
          artists: parts.flatMap((p) => p.artists ?? []),
          playlists: parts.flatMap((p) => p.playlists ?? []),
        };

        // Every list stays in JioSaavn's own response order — no re-ranking, no re-scoring.
        const allTracks = res.tracks ?? [];
        const allAlbums = res.albums ?? [];
        const allArtists = res.artists ?? [];
        const allPlaylists = res.playlists ?? [];

        // Positional only: whichever type has a first result, in track > artist > album priority. Not a
        // relevance pick between types — just "the first thing JioSaavn returned for the type we favor".
        let topResult = null;
        if (offset === 0) {
          if (allTracks[0]) topResult = { type: 'track', item: allTracks[0] };
          else if (allArtists[0]) topResult = { type: 'artist', item: allArtists[0] };
          else if (allAlbums[0]) topResult = { type: 'album', item: allAlbums[0] };
        }

        const more = [allTracks, allAlbums, allArtists, allPlaylists].some((l) => l.length > offset + limit);
        const page = {
          topResult,
          tracks: allTracks.slice(offset, offset + limit),
          albums: allAlbums.slice(offset, offset + limit),
          artists: allArtists.slice(offset, offset + limit),
          playlists: allPlaylists.slice(offset, offset + limit),
          nextOffset: more ? offset + limit : null,
        };
        // Non-enumerable: read by the ttl function above, but never serialized into the cached entry or the
        // JSON response.
        Object.defineProperty(page, 'failed', { value: failed, enumerable: false });
        return page;
      },
    );
  }

  // ---- tracks -----------------------------------------------------------------------------------

  async getTrack(id) {
    const cached = await this.cache.get(`track:v2:${id}`);
    if (cached) return cached;
    const view = trackView(await this.jiosaavn.getSongRaw(id));
    void this.cache.set(`track:v2:${id}`, view, DAY);
    return view;
  }

  // ---- albums -----------------------------------------------------------------------------------

  async getAlbum(id) {
    return this.cache.wrap(`album:v2:${id}`, DAY, async () => {
      const { album, tracks } = await this.jiosaavn.getAlbum(id);
      this.seedTracks(tracks);
      return { ...album, tracks };
    });
  }

  // ---- artists ----------------------------------------------------------------------------------

  async getArtist(id) {
    return this.cache.wrap(`artist:v2:${id}`, DAY / 2, async () => {
      const { artist, topTracks, albums, singles, related } = await this.jiosaavn.getArtist(id);
      this.seedTracks(topTracks);
      return { ...artist, topTracks, albums, singles, related };
    });
  }

  // ---- playlists --------------------------------------------------------------------------------

  /**
   * A JioSaavn playlist and its tracks from ONE upstream call: the response already carries full song
   * objects. Cached briefly and shared by concurrent callers.
   */
  async getPlaylist(id, limit) {
    return this.cache.wrap(`playlist:v2:${id}:${limit}`, 600, async () => {
      const { playlist, tracks } = await this.jiosaavn.getPlaylist(id, limit);
      this.seedTracks(tracks);
      return { ...playlist, tracks };
    });
  }

  /** Leaves the tracks of a page in the per-track cache, off the response path. */
  seedTracks(tracks) {
    for (const t of tracks) void this.cache.set(`track:v2:${t.id}`, t, DAY);
  }
}
