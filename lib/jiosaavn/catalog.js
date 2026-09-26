import { httpErrors } from '@fastify/sensible';

import { fold, tokens } from '../text.js';

import { trackView } from './map.js';

const SEARCH_TIMEOUT_MS = 3500;
/** The most results JioSaavn returns for one search call (a larger `n` is silently cut to this). */
const UPSTREAM_PAGE = 40;
const DAY = 24 * 3600;

/**
 * How well an entity answers the query based on token coverage, prefix matching, and exact match.
 */
export function relevance(query, name, extra = '') {
  const qt = tokens(query);
  if (!qt.length) return 0;
  const nameTokens = new Set(tokens(name));
  const allTokens = new Set([...nameTokens, ...tokens(extra)]);
  const covered = (set) =>
    qt.filter(
      (t, i) => set.has(t) || (i === qt.length - 1 && t.length >= 2 && [...set].some((x) => x.startsWith(t))),
    ).length / qt.length;
  const coverage = covered(allTokens);
  const inName = covered(nameTokens);
  const focus = nameTokens.size ? [...nameTokens].filter((t) => qt.includes(t)).length / nameTokens.size : 0;
  const exact = fold(query) === fold(name) ? 1 : 0;
  return Math.min(1, coverage * 0.6 + inName * 0.15 + focus * 0.15 + exact * 0.1);
}

const names = (artists) => artists.map((a) => a.name).join(' ');

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

    return this.cache.wrap(`search:v5:${typeKey}:${fold(q)}:${limit}:${offset}`, 3600, async () => {
      const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
      // The window is the first offset + limit + 1 results: the extra one is how we know there is a next page.
      // JioSaavn returns at most UPSTREAM_PAGE per call but has many pages, so build the window from as many as needed.
      const pages = Math.ceil((limit + offset + 1) / UPSTREAM_PAGE);
      const parts = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          this.jiosaavn.search(q, types, { signal, limit: UPSTREAM_PAGE, page: i + 1 }),
        ),
      );
      const res = {
        tracks: parts.flatMap((p) => p.tracks ?? []),
        albums: parts.flatMap((p) => p.albums ?? []),
        artists: parts.flatMap((p) => p.artists ?? []),
        playlists: parts.flatMap((p) => p.playlists ?? []),
      };

      // JioSaavn's own order is a starting point; re-rank so the plain song beats remixes and namesakes.
      const allTracks = [...(res.tracks ?? [])].sort(
        (a, b) => relevance(q, b.title, names(b.artists)) - relevance(q, a.title, names(a.artists)),
      );
      const allAlbums = [...(res.albums ?? [])].sort(
        (a, b) => relevance(q, b.title, names(b.artists)) - relevance(q, a.title, names(a.artists)),
      );
      const allArtists = [...(res.artists ?? [])].sort((a, b) => relevance(q, b.name) - relevance(q, a.name));
      const allPlaylists = res.playlists ?? [];

      let topResult = null;
      if (offset === 0) {
        const topArtist = allArtists[0];
        const topTrack = allTracks[0];
        const topAlbum = allAlbums[0];

        const artistRel = topArtist ? relevance(q, topArtist.name) : 0;
        const trackRel = topTrack ? relevance(q, topTrack.title, names(topTrack.artists)) : 0;
        const albumRel = topAlbum ? relevance(q, topAlbum.title, names(topAlbum.artists)) : 0;

        if (artistRel >= 0.8 && artistRel >= trackRel && artistRel >= albumRel) {
          topResult = { type: 'artist', item: topArtist };
        } else if (trackRel >= 0.5 && trackRel >= albumRel) {
          topResult = { type: 'track', item: topTrack };
        } else if (topAlbum && albumRel >= 0.5) {
          topResult = { type: 'album', item: topAlbum };
        } else if (topTrack) {
          topResult = { type: 'track', item: topTrack };
        }
      }

      const more = [allTracks, allAlbums, allArtists, allPlaylists].some((l) => l.length > offset + limit);
      return {
        topResult,
        tracks: allTracks.slice(offset, offset + limit),
        albums: allAlbums.slice(offset, offset + limit),
        artists: allArtists.slice(offset, offset + limit),
        playlists: allPlaylists.slice(offset, offset + limit),
        nextOffset: more ? offset + limit : null,
      };
    });
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
