import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * A JSON cache on top of Redis. Values are stored gzipped (a 200 KB JioSaavn response shrinks 5–10x, which
 * matters over a remote Redis). It is only a cache: a Redis failure is a miss, never an error, and writes
 * never delay the response. Concurrent callers for one key share a single computation.
 */
export function createCache(redis, prefix = 'naad:') {
  const inflight = new Map();

  /** `undefined` is a miss; a cached `null` (negative entry) is a hit. */
  async function get(key) {
    try {
      const packed = await redis.getBuffer(prefix + key);
      if (!packed) return undefined;
      return JSON.parse((await gunzipAsync(packed)).toString('utf8'));
    } catch {
      return undefined;
    }
  }

  async function set(key, value, ttlSec) {
    try {
      const packed = await gzipAsync(Buffer.from(JSON.stringify(value)));
      await redis.set(prefix + key, packed, 'EX', Math.max(1, Math.round(ttlSec)));
    } catch {
      // the value simply is not cached
    }
  }

  /**
   * Returns the cached value, or computes it. A `null` result is cached for `negativeTtlSec` if given.
   * `ttlSec` may instead be a function of the resolved value, for callers whose TTL depends on whether the
   * computation actually succeeded (see `Catalog.search`, which shortens it when upstream calls failed).
   */
  function wrap(key, ttlSec, fn, negativeTtlSec = 0) {
    const running = inflight.get(key);
    if (running) return running;
    const p = (async () => {
      try {
        const hit = await get(key);
        if (hit !== undefined) return hit;
        const value = await fn();
        if (value !== null && value !== undefined) {
          const ttl = typeof ttlSec === 'function' ? ttlSec(value) : ttlSec;
          if (ttl > 0) void set(key, value, ttl);
        } else if (negativeTtlSec > 0) void set(key, null, negativeTtlSec);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  return { get, set, wrap };
}
