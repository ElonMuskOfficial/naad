import { httpErrors } from '@fastify/sensible';

import { fold } from './text.js';

/** What is cached: the lyrics exactly as LRCLIB returned them. */

const FOUND_TTL_SEC = 30 * 86400;
const NOT_FOUND_TTL_SEC = 7 * 86400;

/** Parses LRC ("[mm:ss.xx] line", multiple stamps per line allowed) into sorted timed lines. */
export function parseLrc(lrc) {
  const out = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) {
      const frac = s[3] ? Number(s[3].padEnd(3, '0').slice(0, 3)) : 0;
      out.push({ timeMs: Number(s[1]) * 60_000 + Number(s[2]) * 1000 + frac, text });
    }
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Picks the LRCLIB search result that is the same song: same title, a matching artist, and (when both sides
 * know it) a duration within 5 seconds. Synced lyrics win over plain ones, then the closest duration.
 */
export function pickRecord(list, title, artist, durationMs) {
  const wantTitle = fold(title);
  const wantArtist = fold(artist);
  const gap = (r) =>
    durationMs && r.duration ? Math.abs(r.duration * 1000 - durationMs) : Number.POSITIVE_INFINITY;
  const candidates = list.filter((r) => {
    if (!r.syncedLyrics && !r.plainLyrics) return false;
    if (fold(r.trackName) !== wantTitle) return false;
    const a = fold(r.artistName);
    if (wantArtist && a && !a.includes(wantArtist) && !wantArtist.includes(a)) return false;
    return !durationMs || !r.duration || gap(r) <= 5000;
  });
  candidates.sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || gap(a) - gap(b));
  return candidates[0] ?? null;
}

/** Lyrics from LRCLIB, cached in Redis. A song with no lyrics is remembered for a week so LRCLIB isn't asked again. */
export class LyricsService {
  catalog;
  getJson;
  cache;

  constructor(catalog, getJson, cache) {
    this.catalog = catalog;
    this.getJson = getJson;
    this.cache = cache;
  }

  async get(trackId) {
    const stored = await this.cache.wrap(
      `lyrics:v2:${trackId}`,
      FOUND_TTL_SEC,
      () => this.lookup(trackId),
      NOT_FOUND_TTL_SEC,
    );
    if (!stored) throw httpErrors.notFound('No lyrics available for this track');
    return {
      trackId,
      synced: stored.synced ? parseLrc(stored.synced) : null,
      plain: stored.plain,
      source: 'lrclib',
    };
  }

  /** Asks LRCLIB. A definite "no such song" gives null (and is cached); any other failure is thrown. */
  async lookup(trackId) {
    const t = await this.catalog.getTrack(trackId);
    const artist = t.artists[0]?.name ?? '';

    const exact = new URLSearchParams({ track_name: t.title, artist_name: artist });
    if (t.album) exact.set('album_name', t.album.title);
    if (t.durationMs) exact.set('duration', String(Math.round(t.durationMs / 1000)));
    let rec = null;
    try {
      rec = await this.getJson(`https://lrclib.net/api/get?${exact}`);
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }
    if (!rec) {
      const list = await this.getJson(
        `https://lrclib.net/api/search?${new URLSearchParams({ track_name: t.title, artist_name: artist })}`,
      );
      rec = pickRecord(list, t.title, artist, t.durationMs ?? undefined);
    }
    if (!rec || (!rec.syncedLyrics && !rec.plainLyrics)) return null;
    return { synced: rec.syncedLyrics ?? null, plain: rec.plainLyrics ?? null };
  }
}
