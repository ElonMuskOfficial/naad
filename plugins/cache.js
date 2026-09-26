import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

import { createCache } from '../lib/cache.js';

/**
 * The cache Redis. `fastify.cache` wraps it as a best-effort cache; `fastify.redis` is used directly by /readyz.
 * The library is real state and has its own connection (`libraryRedis`, see library-redis.js).
 */
export default fp(
  async (fastify) => {
    const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0';
    // Upstash only speaks TLS.
    const redis = new Redis(url.includes('upstash.io') ? url.replace(/^redis:/, 'rediss:') : url, {
      maxRetriesPerRequest: 2,
    });
    redis.on('error', (err) => fastify.log.warn({ err: err.message }, 'redis error'));
    fastify.decorate('redis', redis);
    fastify.decorate('cache', createCache(redis));
    fastify.addHook('onClose', async () => void redis.disconnect());
  },
  { name: 'cache' },
);
