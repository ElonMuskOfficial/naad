import { Readable } from 'node:stream';

import { BROWSER_UA } from '../../../lib/upstream.js';

/** Only the image hosts of JioSaavn are fetched, so the proxy cannot be pointed at anything else. */
export const ART_ALLOW_HOSTS = [/^([a-z0-9-]+\.)?saavncdn\.com$/i, /^([a-z0-9-]+\.)?jiosaavn\.com$/i];

export function isAllowedArtHost(hostname) {
  return ART_ALLOW_HOSTS.some((re) => re.test(hostname));
}

/** JioSaavn serves artwork at 50x50, 150x150 and 500x500; snap a requested size to the nearest of those. */
export function applySizeTemplate(url, size) {
  if (!size || size <= 0) return url;
  if (url.includes('saavncdn.com') && /(\d+)x(\d+)/.test(url)) {
    const s = size <= 50 ? 50 : size <= 150 ? 150 : 500;
    return url.replace(/(\d+)x(\d+)/, `${s}x${s}`);
  }
  return url;
}

/** Streams JioSaavn artwork through us (the CDN sends no CORS headers). Exempt from the API key and rate limit. */
const art = async (fastify) => {
  fastify.get(
    '/',
    {
      config: { rateLimit: false },
      schema: {
        querystring: {
          type: 'object',
          required: ['src'],
          properties: {
            src: { type: 'string', format: 'uri' },
            size: { type: 'integer', minimum: 1, maximum: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      let current = applySizeTemplate(req.query.src, req.query.size);
      for (let hop = 0; hop < 4; hop++) {
        const u = new URL(current);
        if (u.protocol !== 'https:' || !isAllowedArtHost(u.hostname)) {
          throw fastify.httpErrors.badRequest(`Image host not allowed: ${u.hostname}`);
        }
        const res = await fetch(current, {
          redirect: 'manual',
          headers: { 'user-agent': BROWSER_UA, accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
          signal: AbortSignal.timeout(10_000),
        });
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
          current = new URL(location, current).toString();
          continue;
        }
        if (res.status !== 200 || !res.body) {
          throw fastify.httpErrors.badGateway(`Image host responded ${res.status}`);
        }
        return reply
          .header('content-type', res.headers.get('content-type') ?? 'image/jpeg')
          .header('cache-control', 'public, max-age=604800, immutable')
          .header('access-control-allow-origin', '*')
          .send(Readable.fromWeb(res.body));
      }
      throw fastify.httpErrors.badGateway('Too many image redirects');
    },
  );
};

export default art;
