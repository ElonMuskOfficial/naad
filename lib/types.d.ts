import type { AutoloadPluginOptions } from '@fastify/autoload';
import type { FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import type { createCache } from './cache.js';
import type { Audio } from './jiosaavn/audio.js';
import type { Catalog } from './jiosaavn/catalog.js';
import type { Discovery } from './jiosaavn/discovery.js';
import type { Podcasts } from './jiosaavn/podcasts.js';
import type { Stations } from './jiosaavn/stations.js';
import type { Collections } from './library/collections.js';
import type { History } from './library/history.js';
import type { Playlists } from './library/playlists.js';
import type { Snapshots } from './library/snapshots.js';
import type { LyricsService } from './lyrics.js';

export interface AppOptions extends FastifyServerOptions, Partial<AutoloadPluginOptions> {
  /** Replaces the global `fetch` for JioSaavn and LRCLIB (used by tests). */
  fetch?: typeof fetch;
}

export type Cache = ReturnType<typeof createCache>;

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    cache: Cache;
    libraryRedis: Redis;
    library: { collections: Collections; playlists: Playlists; history: History; snapshots: Snapshots };
    catalog: Catalog;
    discovery: Discovery;
    stations: Stations;
    podcasts: Podcasts;
    audio: Audio;
    lyrics: LyricsService;
  }
}
