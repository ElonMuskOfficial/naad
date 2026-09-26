import cors from '@fastify/cors';
import fp from 'fastify-plugin';

/** Browsers may call the API from the origins listed in CORS_ORIGINS (comma separated). */
export default fp(async (fastify) => {
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  fastify.register(cors, {
    origin: origins.length ? origins : false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
});
