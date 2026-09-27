import fp from 'fastify-plugin';

import { Audio } from '../lib/jiosaavn/audio.js';
import { Catalog } from '../lib/jiosaavn/catalog.js';
import { JioSaavnClient } from '../lib/jiosaavn/client.js';
import { Discovery } from '../lib/jiosaavn/discovery.js';
import { Podcasts } from '../lib/jiosaavn/podcasts.js';
import { Stations } from '../lib/jiosaavn/stations.js';
import { LyricsService } from '../lib/lyrics.js';
import { jsonClient } from '../lib/upstream.js';

/** The business logic: everything JioSaavn (search, lookups, home, stations, podcasts, audio) plus
 *  LRCLIB lyrics. */
export default fp(
  /**
   * @param {import('fastify').FastifyInstance} fastify
   * @param {import('../lib/types.js').AppOptions} opts
   */
  async (fastify, opts) => {
    const { cache } = fastify;
    const client = new JioSaavnClient(jsonClient('jiosaavn', opts.fetch), cache);
    const catalog = new Catalog(client, cache);
    fastify.decorate('catalog', catalog);
    fastify.decorate('discovery', new Discovery(client));
    fastify.decorate('stations', new Stations(client));
    fastify.decorate('podcasts', new Podcasts(client));
    fastify.decorate('audio', new Audio(client, cache));
    fastify.decorate(
      'lyrics',
      new LyricsService(catalog, jsonClient('lrclib', opts.fetch, { 'lrclib-client': 'naad/1.0' }), cache),
    );
  },
  { name: 'jiosaavn', dependencies: ['cache'] },
);
