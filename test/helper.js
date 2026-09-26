// Shared by the tests: builds the real app (autoloaded plugins and routes) against a disposable Redis and a canned upstream.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { httpErrors } from '@fastify/sensible';

import helper from 'fastify-cli/helper.js';
import { trackView } from '../lib/jiosaavn/map.js';

const here = import.meta.dirname;
const AppPath = join(here, '..', 'app.js');

/** A disposable Redis database, wiped by every build. Never the REDIS_URL of .env. */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';

/** A second disposable database for the library, wiped by every build. */
export const TEST_LIBRARY_REDIS_URL = process.env.TEST_LIBRARY_REDIS_URL ?? 'redis://127.0.0.1:6379/14';

const fixture = (name) => JSON.parse(readFileSync(join(here, 'fixtures', 'jiosaavn', name), 'utf8'));
export const searchFixture = fixture('search-results-kesariya.json');
export const launchFixture = fixture('launch-data.json');

/** A deterministic track: the search fixture's first song under another id. */
export function makeTrack(id, title = `Track ${id}`) {
  return { ...trackView(searchFixture.results[0]), id, title };
}

/**
 * Replaces the catalog lookups with deterministic data (the canned upstream only knows one song). Ids in `fail`
 * make getTrack answer 502, like JioSaavn being down.
 */
export function stubCatalog(app, { fail = new Set() } = {}) {
  app.catalog.getTrack = async (id) => {
    if (fail.has(id)) throw httpErrors.badGateway('upstream down');
    return makeTrack(id);
  };
  app.catalog.getAlbum = async (id) => ({
    id,
    title: `Album ${id}`,
    albumType: 'album',
    releaseDate: null,
    label: null,
    trackCount: 1,
    explicit: false,
    artists: [],
    images: [],
    tracks: [makeTrack(`${id}-t`)],
  });
  app.catalog.getArtist = async (id) => ({
    id,
    name: `Artist ${id}`,
    images: [],
    topTracks: [],
    albums: [],
    singles: [],
    related: [],
  });
  app.catalog.getPlaylist = async (id) => ({
    id,
    title: `Playlist ${id}`,
    description: null,
    trackCount: 1,
    images: [],
    tracks: [makeTrack(`${id}-t`)],
  });
  return app;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Canned JioSaavn and LRCLIB. Records every JioSaavn `__call` in `calls`; unknown operations answer 404
 * and LRCLIB has no lyrics for anything.
 */
export function fakeUpstream() {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'lrclib.net') return url.pathname === '/api/get' ? json({}, 404) : json([]);
    const call = url.searchParams.get('__call') ?? '';
    calls.push(call);
    switch (call) {
      case 'search.getResults':
        return json(searchFixture);
      case 'search.getAlbumResults':
      case 'search.getArtistResults':
      case 'search.getPlaylistResults':
        return json({ total: 0, start: 1, results: [] });
      case 'song.getDetails':
        return json({ songs: [searchFixture.results[0]] });
      case 'webapi.getLaunchData':
        return json(launchFixture);
      default:
        return json({}, 404);
    }
  };
  return { fetch: fetchImpl, calls };
}

/** Builds the app with the given environment and upstream, and closes it when the test ends. */
export async function build(t, opts = {}) {
  const saved = { ...process.env };
  process.env.REDIS_URL = TEST_REDIS_URL;
  process.env.LIBRARY_REDIS_URL = TEST_LIBRARY_REDIS_URL;
  process.env.RATE_LIMIT_PER_MINUTE = '100000';
  process.env.NODE_ENV = 'test';
  process.env.NAAD_API_KEY = '';
  Object.assign(process.env, opts.env);

  const app = await helper.build([AppPath], {
    skipOverride: true,
    fetch: opts.fetch ?? fakeUpstream().fetch,
  });
  await app.redis.flushdb();
  // A test that starts with an unreachable library Redis has nothing to wipe (and flushdb would hang).
  if (opts.flushLibrary !== false) await app.libraryRedis.flushdb();
  t.after(async () => {
    await app.close();
    process.env = saved;
  });
  return app;
}
