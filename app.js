import { join } from 'node:path';
import AutoLoad from '@fastify/autoload';

// Passed to the Fastify constructor by `fastify start`.
export const options = {
  trustProxy: process.env.TRUST_PROXY === 'true',
};

/** @type {import('fastify').FastifyPluginAsync<import('./lib/types.js').AppOptions>} */
export default async function app(fastify, opts) {
  // Plugins first (decorators shared by every route), then routes; the folder name is the URL prefix.
  fastify.register(AutoLoad, {
    dir: join(import.meta.dirname, 'plugins'),
    options: opts,
    forceESM: true,
  });
  fastify.register(AutoLoad, {
    dir: join(import.meta.dirname, 'routes'),
    options: opts,
    forceESM: true,
  });
}
export { app };
