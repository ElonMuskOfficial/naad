import { exec, SNAP } from './util.js';

/** Each collection is a sorted set of ids (score = time added, ms) plus a JSON snapshot per id in `lib:snap`. */
export const KINDS = {
  track: { key: 'lib:liked:tracks', prefix: 't' },
  album: { key: 'lib:saved:albums', prefix: 'a' },
  artist: { key: 'lib:followed:artists', prefix: 'r' },
  playlist: { key: 'lib:saved:playlists', prefix: 'p' },
};

// ZSCORE per id would cost one command per id on a plan billed per command; the loop runs inside Redis.
const CONTAINS = `
local out = {}
for i, id in ipairs(ARGV) do
  if redis.call('ZSCORE', KEYS[1], id) then out[i] = 1 else out[i] = 0 end
end
return out
`;

export class Collections {
  redis;

  /** @param {import('ioredis').Redis} redis */
  constructor(redis) {
    this.redis = redis;
  }

  /** Adds `items` = [{ id, snapshot }]. One already there keeps its original time (idempotent). */
  async add(kind, items) {
    const { key, prefix } = KINDS[kind];
    const now = Date.now();
    const tx = this.redis.multi();
    items.forEach(({ id, snapshot }, i) => {
      tx.zadd(key, 'NX', now + i, id);
      tx.hset(SNAP, `${prefix}:${id}`, JSON.stringify(snapshot));
    });
    await exec(tx);
  }

  /** Removing something that is not there is fine. Snapshots stay: playlists and history may share them. */
  async remove(kind, ids) {
    if (ids.length) await this.redis.zrem(KINDS[kind].key, ...ids);
  }

  /** Newest first. `limit` null lists everything. */
  async list(kind, offset = 0, limit = null) {
    const { key, prefix } = KINDS[kind];
    // One row more than asked for says whether there is a next page, so no ZCARD (and no MULTI) is needed.
    const stop = limit === null ? -1 : offset + limit;
    const flat = await this.redis.zrevrange(key, offset, stop, 'WITHSCORES');
    const ids = [];
    const times = [];
    for (let i = 0; i < flat.length; i += 2) {
      ids.push(flat[i]);
      times.push(Number(flat[i + 1]));
    }
    const more = limit !== null && ids.length > limit;
    if (more) {
      ids.pop();
      times.pop();
    }
    const snaps = ids.length ? await this.redis.hmget(SNAP, ...ids.map((id) => `${prefix}:${id}`)) : [];
    const rows = [];
    ids.forEach((id, i) => {
      const raw = snaps[i];
      if (raw) rows.push({ id, at: new Date(times[i]).toISOString(), snapshot: JSON.parse(raw) });
    });
    const next = more ? String(offset + limit) : null;
    return { rows, next };
  }

  /** `boolean[]` aligned to `ids`, in one command (ZMSCORE needs Redis 6.2, so loop in Lua). */
  async contains(kind, ids) {
    if (!ids.length) return [];
    const found = /** @type {number[]} */ (await this.redis.eval(CONTAINS, 1, KINDS[kind].key, ...ids));
    return found.map((flag) => flag === 1);
  }
}
