import { httpErrors } from '@fastify/sensible';

import { sectionsFromLaunchData } from './home.js';

const DAY = 24 * 3600;

/** Radio and the home feed, both built from JioSaavn responses. */
export class Discovery {
  catalog;
  jiosaavn;
  cache;

  constructor(catalog, jiosaavn, cache) {
    this.catalog = catalog;
    this.jiosaavn = jiosaavn;
    this.cache = cache;
  }

  // ---- home -------------------------------------------------------------------------------------

  /**
   * The home feed mirrors the JioSaavn homepage. One upstream call (`webapi.getLaunchData`) returns every
   * module; the RAW response is cached (gzipped, 10 min) inside `JioSaavnClient.launchData`, and mapping it
   * into sections is cheap.
   */
  async home() {
    return sectionsFromLaunchData(await this.jiosaavn.launchData());
  }

  // ---- radio ------------------------------------------------------------------------------------

  /** An endless-radio queue seeded by `track:<id>`, `artist:<id>`, `album:<id>` or `playlist:<id>`. */
  async radio(seed, limit, exclude) {
    const [kind, id] = seed.split(':');
    if (!id || !['track', 'artist', 'album', 'playlist'].includes(kind)) {
      throw httpErrors.badRequest('seed must be track:<id>, artist:<id>, album:<id> or playlist:<id>');
    }
    const tracks = await this.cache.wrap(`radio:v3:${seed}`, 6 * 3600, () => this.buildRadio(kind, id));
    const skip = new Set([...exclude, id]);
    return { seed, tracks: tracks.filter((x) => !skip.has(x.id)).slice(0, limit) };
  }

  async buildRadio(kind, id) {
    let seeds = [];
    let seedArtistName = null;

    if (kind === 'track') {
      const t = await this.catalog.getTrack(id).catch(() => null);
      if (!t) throw httpErrors.notFound(`Track ${id} not found`);
      seeds = [t];
      seedArtistName = t.artists[0]?.name ?? null;
    } else if (kind === 'artist') {
      const a = await this.catalog.getArtist(id).catch(() => null);
      if (!a) throw httpErrors.notFound(`Artist ${id} not found`);
      seeds = a.topTracks.slice(0, 2);
      seedArtistName = a.name;
    } else if (kind === 'album') {
      const a = await this.catalog.getAlbum(id).catch(() => null);
      if (!a) throw httpErrors.notFound(`Album ${id} not found`);
      seeds = a.tracks.slice(0, 2);
      seedArtistName = a.artists[0]?.name ?? null;
    } else {
      const p = await this.catalog.getPlaylist(id, 3).catch(() => null);
      if (!p) throw httpErrors.notFound(`Playlist ${id} not found`);
      seeds = p.tracks.slice(0, 3);
    }
    if (!seeds.length && !seedArtistName) {
      throw httpErrors.notFound('Seed has no tracks or artist to build a radio from');
    }

    // Songs by the seed artist, plus songs by the artists of the seed tracks.
    const songsBy = (name, n) => this.jiosaavn.searchTracks(name, n).catch(() => []);
    const lookups = [];
    if (seedArtistName) lookups.push(songsBy(seedArtistName, 30));
    for (const t of seeds) if (t.artists[0]) lookups.push(songsBy(t.artists[0].name, 20));
    const streams = (await Promise.all(lookups)).filter((s) => s.length);

    // Interleave the streams, drop the seeds and repeats.
    const merged = [];
    for (let i = 0; merged.length < 120 && streams.some((s) => s[i]); i++) {
      for (const s of streams) if (s[i]) merged.push(s[i]);
    }
    const seen = new Set(seeds.map((t) => t.id));
    const queue = [];
    for (const t of merged) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        queue.push(t);
      }
    }
    for (const t of queue) void this.cache.set(`track:v2:${t.id}`, t, DAY);
    return this.diversify(queue);
  }

  /** Avoid more than two consecutive tracks by the same primary artist. */
  diversify(tracks) {
    const queue = [...tracks];
    const out = [];
    while (queue.length) {
      const last = out.slice(-2).map((t) => t.artists[0]?.id);
      const idx = queue.findIndex(
        (t) => !(last.length === 2 && last[0] === last[1] && last[0] === t.artists[0]?.id),
      );
      out.push(...queue.splice(idx === -1 ? 0 : idx, 1));
    }
    return out;
  }
}
