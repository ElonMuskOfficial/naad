import fp from 'fastify-plugin';

import { Collections } from '../lib/library/collections.js';
import { History } from '../lib/library/history.js';
import { Playlists } from '../lib/library/playlists.js';
import { Snapshots } from '../lib/library/snapshots.js';

/** The user's library (likes, playlists, history) on the library Redis. */
export default fp(
  async (fastify) => {
    const redis = fastify.libraryRedis;
    fastify.decorate('library', {
      collections: new Collections(redis),
      playlists: new Playlists(redis),
      history: new History(redis),
      snapshots: new Snapshots(redis, fastify.catalog),
    });
  },
  { name: 'library', dependencies: ['library-redis', 'jiosaavn'] },
);
