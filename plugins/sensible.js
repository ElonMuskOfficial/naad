import sensible from '@fastify/sensible';
import fp from 'fastify-plugin';

/** Standard HTTP errors (`fastify.httpErrors`) and reply helpers. */
export default fp(async (fastify) => {
  fastify.register(sensible);
});
