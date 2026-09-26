import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build, stubCatalog } from '../helper.js';

const timed = async (promise) => {
  const started = Date.now();
  const res = await promise;
  return { res, ms: Date.now() - started };
};

describe('an unreachable library Redis (Review Focus 5)', () => {
  it('answers 503 for library routes and still serves JioSaavn playlists, all within seconds', async (t) => {
    // 10.255.255.1 swallows packets like a network partition; a refused port would fail fast and prove nothing.
    const app = await build(t, {
      env: { LIBRARY_REDIS_URL: 'redis://10.255.255.1:6379/0' },
      flushLibrary: false,
    });
    stubCatalog(app);

    const [library, playlist, search] = await Promise.all([
      timed(app.inject('/v1/library/tracks')),
      timed(app.inject('/v1/playlists/abc12345')),
      timed(app.inject('/v1/search?q=kesariya&types=track')),
    ]);

    assert.equal(library.res.statusCode, 503);
    assert.equal(library.res.json().statusCode, 503);
    assert.doesNotMatch(library.res.json().message, /max retries|ioredis/i, 'no driver text for the client');
    assert.equal(playlist.res.statusCode, 200);
    assert.equal(playlist.res.json().inLibrary, false);
    assert.equal(search.res.statusCode, 200);
    for (const { ms } of [library, playlist, search]) assert.ok(ms < 12_000, `took ${ms} ms`);
  });

  it('answers 503, not 500, when the library Redis refuses connections', async (t) => {
    const app = await build(t, {
      env: { LIBRARY_REDIS_URL: 'redis://127.0.0.1:1/0' },
      flushLibrary: false,
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/library/tracks',
      payload: { trackIds: ['track-a'] },
    });
    assert.equal(res.statusCode, 503);
  });
});
