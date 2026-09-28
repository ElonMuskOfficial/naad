/** Clears the disposable JioSaavn/lyrics response cache — never the library (likes, playlists, history),
 *  which is real user data on a separate connection (`fastify.libraryRedis`, see plugins/library-redis.js).
 */
const cache = async (fastify) => {
  fastify.delete('/', async (_req, reply) => {
    // LIBRARY_REDIS_URL unset makes libraryRedis literally the same connection as the cache Redis (see
    // plugins/library-redis.js) — flushing it there would also wipe someone's real liked songs, playlists
    // and history. Refuse rather than risk that; a config fix, not a client retry, is what fixes this.
    if (fastify.redis === fastify.libraryRedis) {
      throw fastify.httpErrors.conflict(
        'Cache and library share one Redis (LIBRARY_REDIS_URL is not set) — refusing to clear, ' +
          'since that would also erase the library. Set LIBRARY_REDIS_URL to a separate Redis first.',
      );
    }
    await fastify.redis.flushdb();
    reply.code(204);
  });
};

export default cache;
