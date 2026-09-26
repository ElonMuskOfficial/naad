import { timingSafeEqual } from 'node:crypto';
import { httpErrors } from '@fastify/sensible';
import fp from 'fastify-plugin';

/**
 * Optional shared key: with NAAD_API_KEY set, every /v1 route except artwork needs `Authorization: Bearer <key>`.
 * Without it the API is open, which is only acceptable locally, so production refuses to start that way.
 */
export default fp(async (fastify) => {
  const key = process.env.NAAD_API_KEY?.trim();
  if (!key) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_UNAUTHENTICATED !== 'true') {
      throw new Error('NAAD_API_KEY is required in production (or set ALLOW_UNAUTHENTICATED=true).');
    }
    return;
  }
  const expected = Buffer.from(key);
  // preParsing, not onRequest: the rate limiter's onRequest hook must count a request before a wrong key is refused.
  fastify.addHook('preParsing', async (req) => {
    const path = req.url.split('?')[0] ?? '';
    if (!path.startsWith('/v1/') || path === '/v1/art') return;
    const header = req.headers.authorization ?? '';
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw httpErrors.unauthorized('Missing or invalid API key');
    }
  });
});
