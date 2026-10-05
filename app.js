import { join } from 'node:path';
import AutoLoad from '@fastify/autoload';

import { trustedProxies } from './lib/client-ip.js';

// Passed to the Fastify constructor by `fastify start -o` (without -o, fastify-cli ignores this export).
export const options = {
  trustProxy: trustedProxies(process.env.TRUST_PROXY),
};

/** @type {import('fastify').FastifyPluginAsync<import('./lib/types.js').AppOptions>} */
export default async function app(fastify, opts) {
  if (options.trustProxy === true) {
    fastify.log.warn(
      'TRUST_PROXY=true believes any X-Forwarded-For, so clients can spoof their IP; list your proxies instead',
    );
  }
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
