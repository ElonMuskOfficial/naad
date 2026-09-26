import { exec, SNAP } from './util.js';

const MAX_LOOKUPS = 50;
const MAX_PARALLEL = 8;

/** Track snapshots for ids the library has only a reference to (history rows): stored ones, else the catalog. */
export class Snapshots {
  redis;
  catalog;

  /**
   * @param {import('ioredis').Redis} redis
   * @param {{ getTrack: (id: string) => Promise<any> }} catalog
   */
  constructor(redis, catalog) {
    this.redis = redis;
    this.catalog = catalog;
  }

  /** Map of id -> track for the ids that can be resolved; fetched tracks are stored for next time. */
  async tracks(ids) {
    const unique = [...new Set(ids)];
    /** @type {Map<string, any>} */
    const found = new Map();
    if (!unique.length) return found;
    const stored = await this.redis.hmget(SNAP, ...unique.map((id) => `t:${id}`));
    const missing = [];
    unique.forEach((id, i) => {
      const raw = stored[i];
      if (raw) found.set(id, JSON.parse(raw));
      else missing.push(id);
    });
    if (!missing.length) return found;
    // JioSaavn may be down or a track gone; failed lookups are not remembered, so bound what one request may ask
    // of it: at most MAX_LOOKUPS ids, MAX_PARALLEL at a time. The rest resolve on a later view.
    const wanted = missing.slice(0, MAX_LOOKUPS);
    const tx = this.redis.multi();
    let wrote = 0;
    for (let from = 0; from < wanted.length; from += MAX_PARALLEL) {
      const batch = wanted.slice(from, from + MAX_PARALLEL);
      const fetched = await Promise.allSettled(batch.map((id) => this.catalog.getTrack(id)));
      fetched.forEach((result, i) => {
        const id = batch[i];
        if (result.status !== 'fulfilled' || id === undefined) return;
        found.set(id, result.value);
        tx.hset(SNAP, `t:${id}`, JSON.stringify(result.value));
        wrote++;
      });
    }
    if (wrote) await exec(tx);
    return found;
  }
}
