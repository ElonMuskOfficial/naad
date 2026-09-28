import { httpErrors } from '@fastify/sensible';

import {
  albumView,
  artistView,
  episodeView,
  playlistView,
  seasonView,
  showView,
  trackView,
} from './map.js';

const BASE = 'https://www.jiosaavn.com/api.php';

/**
 * Client for JioSaavn's private web API (`api.php`). Every operation is a GET selected by `__call`;
 * results come back already mapped to the API's view types.
 */
export class JioSaavnClient {
  getJson;
  cache;

  constructor(getJson, cache) {
    this.getJson = getJson;
    this.cache = cache;
  }

  async call(
    call,
    params,
    signal,
    /** When set, the RAW response is cached (gzipped, in Redis) for this many seconds and shared. */
    cacheTtlSec,
    /** Extra request headers (e.g. the `Cookie: L=<language>` a few calls need — see `fetchCall`). Not
     *  part of the cache key on its own; callers that vary by it must also vary `params`. */
    headers,
  ) {
    if (!cacheTtlSec) return this.fetchCall(call, params, signal, headers);
    const sorted = Object.entries(params)
      .map(([k, v]) => /** @type {[string, string]} */ ([k, String(v)]))
      .sort(([a], [b]) => a.localeCompare(b));
    const key = `jiosaavn:raw:v1:${call}:${new URLSearchParams(sorted)}`;
    return this.cache.wrap(key, cacheTtlSec, () => this.fetchCall(call, params, signal, headers));
  }

  async fetchCall(call, params, signal, headers) {
    const qs = new URLSearchParams({
      __call: call,
      _format: 'json',
      _marker: '0',
      api_version: '4',
      ctx: 'web6dot0',
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });
    const data = await this.getJson(`${BASE}?${qs}`, signal, headers);
    if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data && data.error) {
      throw httpErrors.notFound(`jiosaavn ${call}: ${JSON.stringify(data.error).slice(0, 120)}`);
    }
    return data;
  }

  /** The whole JioSaavn homepage in one call (~230 KB raw). Cached raw for 10 minutes. */
  async launchData(signal) {
    return this.call('webapi.getLaunchData', {}, signal, 10 * 60);
  }

  // ---- search ---------------------------------------------------------------------------------

  async searchTracks(q, limit, signal, page = 1) {
    const data = await this.call('search.getResults', { q, p: page, n: limit }, signal);
    return (data.results ?? [])
      .filter((r) => r.type === 'song' || r.type === undefined)
      .map((s) => trackView(s));
  }

  /**
   * Runs the requested searches in parallel. A failing search yields an empty list rather than an error, but
   * `failed` is set so the caller can tell "upstream errored" apart from "genuinely no matches" (and avoid
   * caching the former as if it were the latter).
   */
  async search(query, types, opts = {}) {
    const limit = opts.limit ?? 10;
    const page = opts.page ?? 1;
    const { signal } = opts;
    const params = { q: query, p: page, n: limit };
    const out = {};
    const jobs = [];
    let failed = false;

    if (types.includes('track')) {
      jobs.push(
        this.searchTracks(query, limit, signal, page).then(
          (r) => {
            out.tracks = r;
          },
          () => {
            out.tracks = [];
            failed = true;
          },
        ),
      );
    }
    if (types.includes('album')) {
      jobs.push(
        this.call('search.getAlbumResults', params, signal).then(
          (r) => {
            out.albums = (r.results ?? []).map((a) => albumView(a));
          },
          () => {
            out.albums = [];
            failed = true;
          },
        ),
      );
    }
    if (types.includes('artist')) {
      jobs.push(
        this.call('search.getArtistResults', params, signal).then(
          (r) => {
            out.artists = (r.results ?? []).filter((a) => a.id && a.name).map(artistView);
          },
          () => {
            out.artists = [];
            failed = true;
          },
        ),
      );
    }
    if (types.includes('playlist')) {
      jobs.push(
        this.call('search.getPlaylistResults', params, signal).then(
          (r) => {
            out.playlists = (r.results ?? []).map(playlistView);
          },
          () => {
            out.playlists = [];
            failed = true;
          },
        ),
      );
    }
    if (types.includes('show')) {
      const showParams = { ...params, query, params: JSON.stringify({ type: 'podcasts' }) };
      jobs.push(
        this.call('search.getMoreResults', showParams, signal).then(
          (r) => {
            out.shows = (r.results ?? []).map(showView);
          },
          () => {
            out.shows = [];
            failed = true;
          },
        ),
      );
    }

    await Promise.all(jobs);
    out.failed = failed;
    return out;
  }

  // ---- songs ----------------------------------------------------------------------------------

  async getSongRaw(id, signal) {
    const data = await this.call('song.getDetails', { pids: id }, signal);
    const song = data.songs?.[0] ?? data[id];
    if (!song) throw httpErrors.notFound(`jiosaavn song ${id} not found`);
    return song;
  }

  // ---- albums, artists, playlists -----------------------------------------------------------------

  async getAlbum(id, signal) {
    const a = await this.call('content.getAlbumDetails', { albumid: id }, signal);
    if (!a?.id) throw httpErrors.notFound(`jiosaavn album ${id} not found`);
    const list = Array.isArray(a.list) ? a.list : [];
    const album = albumView(a, list.length);
    const tracks = list.map((s, i) =>
      trackView(s, {
        album: { id: album.id, title: album.title, images: album.images },
        trackNumber: i + 1,
      }),
    );
    return { album, tracks };
  }

  async getArtist(id, signal) {
    const a = await this.call(
      'artist.getArtistPageDetails',
      { artistId: id, n_song: 20, n_album: 20 },
      signal,
    );
    if (!a?.name) throw httpErrors.notFound(`jiosaavn artist ${id} not found`);
    return {
      artist: artistView({ id, name: a.name, image: a.image }),
      topTracks: (a.topSongs ?? []).map((s) => trackView(s)),
      albums: (a.topAlbums ?? []).map((x) => albumView(x)),
      singles: (a.singles ?? []).map((x) => albumView(x)),
      related: (a.similarArtists ?? []).filter((s) => s.id && s.name).map(artistView),
    };
  }

  async getPlaylist(id, limit = 100, signal) {
    const p = await this.call('playlist.getDetails', { listid: id, n: limit, p: 1 }, signal);
    if (!p?.id) throw httpErrors.notFound(`jiosaavn playlist ${id} not found`);
    return {
      playlist: playlistView(p),
      tracks: (Array.isArray(p.list) ? p.list : []).map((s) => trackView(s)),
    };
  }

  // ---- radio stations & podcasts ---------------------------------------------------------------

  /** JioSaavn's own Browse page in one call: featured radio stations (`radio.featured_stations`), the
   *  podcast catalog (`top_shows.shows`), plus modules naad has no use for. Raw response cached 10 minutes,
   *  like `launchData`, and mapped by the caller — the same split `launchData`/`sectionsFromLaunchData` use.
   *
   *  `language` does nothing as a query param here — confirmed live, it silently returns Hindi regardless.
   *  What actually selects it is the `L` cookie JioSaavn's own site sets from a user's saved preference; we
   *  fake that with a fixed `Cookie: L=<language>` header instead of a real session. */
  async browseModules(language, signal) {
    const headers = language ? { cookie: `L=${language}; DL=${language}` } : undefined;
    return this.call('content.getBrowseModules', { language: language ?? '' }, signal, 10 * 60, headers);
  }

  /** Starts one of JioSaavn's curated stations (by `name` — a browse listing's `id`, JioSaavn's own
   *  internal/romanized station name; its `title` is only the localized display text and, passed here
   *  instead, creates a station with no songs — confirmed live) and returns its station id, an opaque
   *  handle for `getStationSongs`. */
  async createStation(name, language, signal) {
    const data = await this.call(
      'webradio.createFeaturedStation',
      { name, language: language ?? '', pid: '', query: '', mode: '', artistid: '' },
      signal,
    );
    if (!data?.stationid) throw httpErrors.notFound(`jiosaavn station "${name}" not found`);
    return data.stationid;
  }

  /** The next batch of songs from a station started with `createStation`. Never cached: each call advances
   *  the station's own position, so caching it would repeat or drop songs. */
  async getStationSongs(stationId, limit, signal) {
    const data = await this.call('webradio.getSong', { stationid: stationId, k: limit, next: 1 }, signal);
    return Object.values(data ?? {})
      .map((entry) => entry.song)
      .filter(Boolean)
      .map((s) => trackView(s));
  }

  /** A show's details, seasons and episodes for one season. `seasonNumber` omitted asks JioSaavn for its
   *  default (the latest season). */
  async getShow(token, seasonNumber, signal) {
    const data = await this.call(
      'webapi.get',
      { token, type: 'show', season_number: seasonNumber ?? '', sort_order: '', includeMetaTags: 0 },
      signal,
    );
    if (!data?.show_details) throw httpErrors.notFound(`jiosaavn show ${token} not found`);
    return {
      show: showView(data.show_details),
      seasons: (Array.isArray(data.seasons) ? data.seasons : []).map(seasonView),
      episodes: (Array.isArray(data.episodes) ? data.episodes : []).map(episodeView),
    };
  }
}
