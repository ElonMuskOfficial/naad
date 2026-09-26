import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

/**
 * The library (likes, playlists, history) is the only persistent state, so it can live in its own Redis
 * (`LIBRARY_REDIS_URL`) that must not evict. Unset, it shares the cache Redis, which is fine for local use.
 */
export default fp(
  async (fastify) => {
    const url = process.env.LIBRARY_REDIS_URL?.trim();
    if (!url) {
      fastify.log.warn('LIBRARY_REDIS_URL is not set: the library shares REDIS_URL');
      fastify.decorate('libraryRedis', fastify.redis);
      return;
    }
    // Upstash only speaks TLS.
    // Bounded waits: a partitioned Redis must fail a request in seconds, not hold it for the driver's defaults.
    const redis = new Redis(url.includes('upstash.io') ? url.replace(/^redis:/, 'rediss:') : url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      commandTimeout: 3000,
    });
    redis.on('error', (err) => fastify.log.warn({ err: err.message }, 'library redis error'));
    fastify.decorate('libraryRedis', redis);
    fastify.addHook('onClose', async () => void redis.disconnect());

    // Best effort: managed Redis may forbid CONFIG, in which case there is nothing to warn about.
    redis.config('GET', 'maxmemory-policy').then(
      ([, policy]) => {
        if (policy && policy !== 'noeviction') {
          fastify.log.warn({ policy }, 'the library Redis may evict data: set maxmemory-policy noeviction');
        }
      },
      () => {},
    );
  },
  { name: 'library-redis', dependencies: ['cache'] },
);
