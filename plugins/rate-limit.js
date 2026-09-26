import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';

/** Per-IP limit on every route (artwork opts out in its route config). Counted in memory. */
export default fp(async (fastify) => {
  fastify.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 240),
    timeWindow: '1 minute',
  });
});
