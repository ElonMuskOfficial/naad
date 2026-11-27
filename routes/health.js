const check = (redis) =>
  redis.ping().then(
    () => 'ok',
    (err) => err.message,
  );

const health = async (fastify) => {
  /** Liveness: the process is up. */
  fastify.get('/healthz', async () => ({ status: 'ok' }));

  /** Readiness: the cache Redis and the library Redis are reachable. */
  fastify.get('/readyz', async (_req, reply) => {
    const checks = { redis: await check(fastify.redis), library: await check(fastify.libraryRedis) };
    const ready = Object.values(checks).every((c) => c === 'ok');
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks });
  });
};

export default health;
