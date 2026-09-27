import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Catalog } from '../../lib/jiosaavn/catalog.js';

// When JioSaavn calls fail (timeout, network, ...), JioSaavnClient.search() still resolves with empty lists
// (see lib/jiosaavn/client.js) but marks the result `failed`. The catalog must cache that outcome only briefly,
// instead of treating it like a genuine "no results" for the usual hour-long TTL — and must never leak the
// `failed` marker into the response it hands back.
function catalogWith(failed) {
  const jiosaavn = {
    search: async () => ({ tracks: [], albums: [], artists: [], playlists: [], failed }),
  };
  let capturedTtlFn;
  const cache = {
    wrap: async (_key, ttlSec, fn) => {
      capturedTtlFn = ttlSec;
      return fn();
    },
    get: async () => undefined,
    set: async () => {},
  };
  return { catalog: new Catalog(jiosaavn, cache), ttlFnOf: () => capturedTtlFn };
}

describe('search caching after an upstream failure', () => {
  it('gives a failed search a short ttl instead of the normal hour', async () => {
    const { catalog, ttlFnOf } = catalogWith(true);
    const res = await catalog.search('anything', ['track'], 20, 0);
    const ttl = ttlFnOf()(res);
    assert.ok(ttl <= 60, `expected a short ttl for a failed search, got ${ttl}`);
  });

  it('gives a genuinely empty (non-failed) search the normal hour-long ttl', async () => {
    const { catalog, ttlFnOf } = catalogWith(false);
    const res = await catalog.search('anything', ['track'], 20, 0);
    const ttl = ttlFnOf()(res);
    assert.equal(ttl, 3600);
  });

  it('never leaks the failed marker into the response (JSON or enumeration)', async () => {
    const { catalog } = catalogWith(true);
    const res = await catalog.search('anything', ['track'], 20, 0);
    assert.equal(JSON.stringify(res).includes('failed'), false);
    assert.equal(Object.keys(res).includes('failed'), false);
  });
});
