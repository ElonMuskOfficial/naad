import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build, fakeUpstream } from '../helper.js';

describe('service basics', () => {
  it('liveness and readiness (cache and library Redis)', async (t) => {
    const app = await build(t);
    assert.equal((await app.inject('/healthz')).statusCode, 200);
    const ready = await app.inject('/readyz');
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json().checks, { redis: 'ok', library: 'ok' });
  });

  it('bad input is a 400 in the standard Fastify error format', async (t) => {
    const app = await build(t);
    for (const url of [
      '/v1/search?q=',
      '/v1/search',
      '/v1/search?q=x&types=song',
      '/v1/radio?seed=x',
      '/v1/tracks/ab',
    ]) {
      const res = await app.inject(url);
      assert.equal(res.statusCode, 400, url);
      assert.equal(res.json().error, 'Bad Request');
      assert.ok(res.json().message);
    }
  });

  it('unknown routes and routes of features naad does not have are 404', async (t) => {
    const app = await build(t);
    for (const url of [
      '/v1/nope',
      '/v1/imports/x',
      '/v1/mixes',
      '/v1/resolve',
      '/v1/stream/abcdefghij',
      '/docs',
    ]) {
      assert.equal((await app.inject(url)).statusCode, 404, url);
    }
  });
});

describe('JioSaavn-backed routes (canned upstream)', () => {
  it('search returns cleaned tracks with a top result, and is cached', async (t) => {
    const up = fakeUpstream();
    const app = await build(t, { fetch: up.fetch });
    const searches = () => up.calls.filter((c) => c === 'search.getResults').length;

    const res = await app.inject('/v1/search?q=kesariya&types=track&limit=3');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.tracks[0].id, 'rjkrTnma');
    assert.equal(body.tracks[0].title, 'Kesariya');
    assert.ok(body.tracks[0].artists.some((a) => a.name === 'Arijit Singh'));
    assert.equal(body.topResult.type, 'track');

    await new Promise((r) => setTimeout(r, 50)); // the cache write lands after the response
    const before = searches();
    await app.inject('/v1/search?q=kesariya&types=track&limit=3');
    assert.equal(searches(), before);
  });

  it('home mirrors the JioSaavn homepage', async (t) => {
    const app = await build(t);
    const res = await app.inject('/v1/home');
    assert.equal(res.statusCode, 200);
    const titles = res.json().sections.map((s) => s.title);
    assert.deepEqual(titles.slice(0, 3), ['Trending Now', 'Top Charts', 'New Releases']);
  });

  it('audio gives the CDN URL, choosing the best bitrate the song has', async (t) => {
    const app = await build(t);
    const res = await app.inject('/v1/tracks/rjkrTnma/audio');
    assert.equal(res.statusCode, 200);
    const audio = res.json();
    assert.equal(audio.trackId, 'rjkrTnma');
    assert.equal(audio.mimeType, 'audio/mp4');
    assert.equal(audio.codec, 'aac');
    assert.equal(audio.bitrateKbps, 320);
    assert.equal(audio.durationMs, 268_000);
    assert.match(audio.url, /^https:\/\/aac\.saavncdn\.com\/.+_320\.mp4$/);
    assert.match((await app.inject('/v1/tracks/rjkrTnma/audio?quality=96')).json().url, /_96\.mp4$/);
    assert.equal((await app.inject('/v1/tracks/rjkrTnma/audio?quality=999')).statusCode, 400);
  });

  it('prefetch is accepted', async (t) => {
    const app = await build(t);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/player/prefetch',
      payload: { trackIds: ['rjkrTnma'] },
    });
    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.json(), { accepted: 1 });
    assert.equal(
      (await app.inject({ method: 'POST', url: '/v1/player/prefetch', payload: { trackIds: [] } }))
        .statusCode,
      400,
    );
  });

  it('lyrics that LRCLIB does not have are a clean 404', async (t) => {
    const app = await build(t);
    assert.equal((await app.inject('/v1/tracks/rjkrTnma/lyrics')).statusCode, 404);
  });

  it('serves synced lyrics when available from LRCLIB', async (t) => {
    const upstream = fakeUpstream();
    const origFetch = upstream.fetch;
    const fetchImpl = async (input) => {
      const url = new URL(String(input));
      if (url.hostname === 'lrclib.net' && url.pathname === '/api/get') {
        return new Response(JSON.stringify({ syncedLyrics: '[00:01.00]Hello', plainLyrics: 'Hello' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return origFetch(input);
    };
    const app = await build(t, { fetch: fetchImpl });
    const res = await app.inject('/v1/tracks/rjkrTnma/lyrics');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.source, 'lrclib');
    assert.deepEqual(body.synced, [{ timeMs: 1000, text: 'Hello' }]);
    assert.equal(body.plain, null);
  });

  it('an unknown upstream id is a 404, not a crash', async (t) => {
    const app = await build(t);
    assert.equal((await app.inject('/v1/albums/999')).statusCode, 404);
    assert.equal((await app.inject('/v1/artists/999')).statusCode, 404);
    assert.equal((await app.inject('/v1/playlists/999')).statusCode, 404);
  });

  it('an unreachable upstream is a 502, not a crash', async (t) => {
    const app = await build(t, {
      fetch: async () => {
        throw new Error('network down');
      },
    });
    assert.equal((await app.inject('/v1/tracks/rjkrTnma')).statusCode, 502);
  });

  it('artwork is refused for hosts other than JioSaavn', async (t) => {
    const app = await build(t);
    assert.equal((await app.inject('/v1/art?src=https%3A%2F%2Fi.ytimg.com%2Fx.jpg')).statusCode, 400);
  });
});
