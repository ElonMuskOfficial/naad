import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCache } from '../../lib/cache.js';

/** A minimal in-memory Redis: getBuffer and set with EX. */
function fakeRedis(opts = {}) {
  const store = new Map();
  const ttls = new Map();
  const redis = {
    getBuffer: async (k) => {
      if (opts.failing) throw new Error('down');
      return store.get(k) ?? null;
    },
    set: async (k, v, _ex, ttl) => {
      if (opts.failing) throw new Error('down');
      store.set(k, v);
      ttls.set(k, ttl);
    },
  };
  return { redis, store, ttls };
}

/** Writes happen after the value is returned; give them a moment to land. */
const settle = () => new Promise((r) => setTimeout(r, 10));

describe('cache', () => {
  it('computes once, then serves from Redis (stored gzipped with the given TTL)', async () => {
    const { redis, store, ttls } = fakeRedis();
    const cache = createCache(redis);
    let runs = 0;
    const fn = async () => ({ n: ++runs });
    assert.deepEqual(await cache.wrap('k', 60, fn), { n: 1 });
    await settle();
    assert.deepEqual(await cache.wrap('k', 60, fn), { n: 1 });
    assert.equal(runs, 1);
    assert.equal(ttls.get('naad:k'), 60);
    assert.deepEqual([...store.get('naad:k').subarray(0, 2)], [0x1f, 0x8b]);
  });

  it('shares one computation between concurrent callers', async () => {
    const cache = createCache(fakeRedis().redis);
    let runs = 0;
    const fn = async () => {
      await settle();
      return ++runs;
    };
    const results = await Promise.all([
      cache.wrap('k', 60, fn),
      cache.wrap('k', 60, fn),
      cache.wrap('k', 60, fn),
    ]);
    assert.deepEqual(results, [1, 1, 1]);
  });

  it('remembers a null result only when a negative TTL is given', async () => {
    const cache = createCache(fakeRedis().redis);
    let runs = 0;
    const none = async () => {
      runs++;
      return null;
    };
    await cache.wrap('a', 60, none);
    await settle();
    await cache.wrap('a', 60, none);
    assert.equal(runs, 2);
    await cache.wrap('b', 60, none, 30);
    await settle();
    assert.equal(await cache.wrap('b', 60, none, 30), null);
    assert.equal(runs, 3);
  });

  it('treats a Redis failure as a miss, never as an error', async () => {
    const cache = createCache(fakeRedis({ failing: true }).redis);
    assert.equal(await cache.wrap('k', 60, async () => 'fresh'), 'fresh');
    assert.equal(await cache.get('k'), undefined);
  });

  it('does not cache a failed computation', async () => {
    const cache = createCache(fakeRedis().redis);
    await assert.rejects(cache.wrap('k', 60, async () => Promise.reject(new Error('boom'))));
    assert.equal(await cache.wrap('k', 60, async () => 'ok'), 'ok');
  });

  it('lets ttlSec be a function of the resolved value', async () => {
    const { redis, ttls } = fakeRedis();
    const cache = createCache(redis);
    const ttlSec = (value) => (value.ok ? 3600 : 30);
    await cache.wrap('good', ttlSec, async () => ({ ok: true }));
    await settle();
    assert.equal(ttls.get('naad:good'), 3600);
    await cache.wrap('bad', ttlSec, async () => ({ ok: false }));
    await settle();
    assert.equal(ttls.get('naad:bad'), 30);
  });
});
