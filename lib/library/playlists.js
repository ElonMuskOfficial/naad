import { randomUUID } from 'node:crypto';
import { httpErrors } from '@fastify/sensible';

import { exec, SNAP } from './util.js';

export const USER_PLAYLIST_ID = /^usr_[0-9a-f-]{36}$/;
export const MAX_PLAYLIST_TRACKS = 1000;

const INDEX = 'lib:playlists';
// id -> JSON view (title, count, cover image), rebuilt by refresh() after every change, so that listing the
// sidebar costs one command instead of several per playlist (a hosted plan bills per command).
const VIEWS = 'lib:pl:views';
const withoutCreatedAt = ({ createdAt: _createdAt, ...view }) => view;
const meta = (id) => `lib:pl:${id}`;
const order = (id) => `lib:pl:${id}:order`;
const entries = (id) => `lib:pl:${id}:entries`;

// Moves an item right after another one (or to the front), only if both are still in the list. Runs in Redis
// so the check and the move are one step (LPOS needs Redis 6.0.6, so scan). 1 = moved, 0 = not found.
const MOVE = `
local function has(v)
  for _, x in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do if x == v then return true end end
  return false
end
if not has(ARGV[1]) then return 0 end
if ARGV[2] == ARGV[1] then return 1 end
if ARGV[2] == '' then
  redis.call('LREM', KEYS[1], 0, ARGV[1])
  redis.call('LPUSH', KEYS[1], ARGV[1])
  return 1
end
if not has(ARGV[2]) then return 0 end
redis.call('LREM', KEYS[1], 0, ARGV[1])
redis.call('LINSERT', KEYS[1], 'AFTER', ARGV[2], ARGV[1])
return 1
`;

/** User playlists: a hash of metadata, a list of item ids (the order) and a hash of item id -> { trackId, addedAt }. */
export class Playlists {
  redis;

  /** @param {import('ioredis').Redis} redis */
  constructor(redis) {
    this.redis = redis;
  }

  tooLarge() {
    return httpErrors.badRequest(`A playlist holds at most ${MAX_PLAYLIST_TRACKS} tracks`);
  }

  /** Queues the writes for `tracks` (full track snapshots) at the end of a playlist; returns the new item ids. */
  queueItems(tx, id, tracks, now) {
    const itemIds = [];
    for (const track of tracks) {
      const itemId = randomUUID();
      itemIds.push(itemId);
      tx.rpush(order(id), itemId);
      tx.hset(entries(id), itemId, JSON.stringify({ trackId: track.id, addedAt: now }));
      tx.hset(SNAP, `t:${track.id}`, JSON.stringify(track));
    }
    return itemIds;
  }

  async create({ title, description = null, tracks = [] }) {
    if (tracks.length > MAX_PLAYLIST_TRACKS) throw this.tooLarge();
    const id = `usr_${randomUUID()}`;
    const now = new Date().toISOString();
    const tx = this.redis.multi();
    tx.hset(meta(id), { title, description: description ?? '', createdAt: now, updatedAt: now });
    tx.zadd(INDEX, Date.now(), id);
    this.queueItems(tx, id, tracks, now);
    await exec(tx);
    await this.refresh(id);
    return id;
  }

  /** Rebuilds the stored view of a playlist (or drops it if the playlist is gone). Call after every change. */
  async refresh(id) {
    const [m, count, first] = await exec(
      this.redis.multi().hgetall(meta(id)).llen(order(id)).lindex(order(id), 0),
    );
    if (m.title === undefined) {
      await this.redis.hdel(VIEWS, id);
      return;
    }
    let images = [];
    if (first) {
      const entry = await this.redis.hget(entries(id), first);
      const snap = entry ? await this.redis.hget(SNAP, `t:${JSON.parse(entry).trackId}`) : null;
      if (snap) images = JSON.parse(snap).images;
    }
    const view = {
      id,
      title: m.title,
      description: m.description || null,
      origin: 'user',
      inLibrary: true,
      images,
      trackCount: count,
      createdAt: m.createdAt,
    };
    await this.redis.hset(VIEWS, id, JSON.stringify(view));
  }

  /** The playlist as the library lists it, or null if there is no such user playlist. One command. */
  async view(id) {
    const raw = await this.redis.hget(VIEWS, id);
    return raw ? withoutCreatedAt(JSON.parse(raw)) : null;
  }

  /** All user playlists, newest first. One command. */
  async list() {
    const all = Object.values(await this.redis.hgetall(VIEWS)).map((raw) => JSON.parse(raw));
    all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return all.map(withoutCreatedAt);
  }

  /** [{ itemId, addedAt, track }] in playlist order; an item whose snapshot is missing is skipped. */
  async items(id, limit = null) {
    const itemIds = await this.redis.lrange(order(id), 0, limit === null ? -1 : limit - 1);
    if (!itemIds.length) return [];
    const raw = await this.redis.hmget(entries(id), ...itemIds);
    const rows = itemIds.flatMap((itemId, i) => (raw[i] ? [{ itemId, entry: JSON.parse(raw[i]) }] : []));
    if (!rows.length) return [];
    const snaps = await this.redis.hmget(SNAP, ...rows.map((r) => `t:${r.entry.trackId}`));
    return rows.flatMap((r, i) =>
      snaps[i] ? [{ itemId: r.itemId, addedAt: r.entry.addedAt, track: JSON.parse(snaps[i]) }] : [],
    );
  }

  async update(id, { title, description }) {
    const fields = { updatedAt: new Date().toISOString() };
    if (title !== undefined) fields.title = title;
    if (description !== undefined) fields.description = description ?? '';
    await this.redis.hset(meta(id), fields);
    await this.refresh(id);
  }

  async remove(id) {
    const tx = this.redis.multi().del(meta(id), order(id), entries(id)).zrem(INDEX, id).hdel(VIEWS, id);
    await exec(tx);
  }

  /** Appends `tracks` (or puts them first, in the given order, with position 'start'). Returns the new item ids. */
  async addItems(id, tracks, position = 'end') {
    if ((await this.redis.llen(order(id))) + tracks.length > MAX_PLAYLIST_TRACKS) throw this.tooLarge();
    const now = new Date().toISOString();
    const tx = this.redis.multi();
    let itemIds;
    if (position === 'start') {
      itemIds = tracks.map(() => randomUUID());
      tracks.forEach((track, i) => {
        tx.hset(entries(id), itemIds[i], JSON.stringify({ trackId: track.id, addedAt: now }));
        tx.hset(SNAP, `t:${track.id}`, JSON.stringify(track));
      });
      // LPUSH puts the last argument first, so push in reverse to keep the given order.
      if (itemIds.length) tx.lpush(order(id), ...[...itemIds].reverse());
    } else {
      itemIds = this.queueItems(tx, id, tracks, now);
    }
    tx.hset(meta(id), 'updatedAt', now);
    await exec(tx);
    await this.refresh(id);
    return itemIds;
  }

  /** Removing an item that is not there is fine. */
  async removeItems(id, itemIds) {
    const tx = this.redis.multi();
    for (const itemId of itemIds) tx.lrem(order(id), 0, itemId);
    tx.hdel(entries(id), ...itemIds);
    tx.hset(meta(id), 'updatedAt', new Date().toISOString());
    await exec(tx);
    await this.refresh(id);
  }

  /** Puts `itemId` right after `afterItemId`, or first when that is null. 404 if either is not in the playlist. */
  async move(id, itemId, afterItemId) {
    const moved = await this.redis.eval(MOVE, 1, order(id), itemId, afterItemId ?? '');
    if (moved !== 1) throw httpErrors.notFound('Item not found in this playlist');
    await this.refresh(id); // the cover is the first item's, and the first item may have changed
  }
}
