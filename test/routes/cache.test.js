import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build } from '../helper.js';

describe('DELETE /v1/cache', () => {
  it('clears the cache Redis, leaving the library Redis untouched', async (t) => {
    const app = await build(t);
    await app.redis.set('naad:some-cached-thing', 'x');
    await app.libraryRedis.set('lib:some-real-data', 'y');

    const res = await app.inject({ method: 'DELETE', url: '/v1/cache' });
    assert.equal(res.statusCode, 204);

    assert.equal(await app.redis.get('naad:some-cached-thing'), null);
    assert.equal(await app.libraryRedis.get('lib:some-real-data'), 'y');
  });

  it('refuses when the cache and library share one Redis, rather than risk the library', async (t) => {
    const app = await build(t, { env: { LIBRARY_REDIS_URL: '' }, flushLibrary: false });
    const res = await app.inject({ method: 'DELETE', url: '/v1/cache' });
    assert.equal(res.statusCode, 409);
  });
});
