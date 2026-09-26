import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build } from '../helper.js';

describe('health', () => {
  it('is alive and ready with both Redis connections up', async (t) => {
    const app = await build(t);
    assert.deepEqual((await app.inject('/healthz')).json(), { status: 'ok' });
    const ready = await app.inject('/readyz');
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), { status: 'ready', checks: { redis: 'ok', library: 'ok' } });
  });

  it('is not ready when the cache Redis is gone', async (t) => {
    const app = await build(t);
    app.redis.disconnect();
    const ready = await app.inject('/readyz');
    assert.equal(ready.statusCode, 503);
    assert.notEqual(ready.json().checks.redis, 'ok');
    assert.equal(ready.json().checks.library, 'ok');
  });

  it('is not ready when the library Redis is gone, while the API still answers', async (t) => {
    const app = await build(t);
    assert.notEqual(app.libraryRedis, app.redis, 'the test setup must use two connections');
    app.libraryRedis.disconnect();
    const ready = await app.inject('/readyz');
    assert.equal(ready.statusCode, 503);
    assert.equal(ready.json().checks.redis, 'ok');
    assert.notEqual(ready.json().checks.library, 'ok');
    assert.equal((await app.inject('/v1/search?q=kesariya&types=track')).statusCode, 200);
  });

  it('shares the cache Redis when LIBRARY_REDIS_URL is unset', async (t) => {
    const app = await build(t, { env: { LIBRARY_REDIS_URL: '' } });
    assert.equal(app.libraryRedis, app.redis);
  });
});
