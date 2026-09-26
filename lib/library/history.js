import { exec } from './util.js';

const KEY = 'lib:history';
export const MAX_HISTORY = 5000;

/** Plays, newest first, as JSON rows in one list capped at MAX_HISTORY. */
export class History {
  redis;

  /** @param {import('ioredis').Redis} redis */
  constructor(redis) {
    this.redis = redis;
  }

  /** `listens` may arrive in any order; they are stored so that the newest ends up first. */
  async append(listens) {
    const ordered = [...listens].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const tx = this.redis.multi();
    for (const l of ordered) {
      tx.lpush(
        KEY,
        JSON.stringify({
          trackId: l.trackId,
          playedAt: l.startedAt,
          msPlayed: l.msPlayed,
          completed: l.completed ?? false,
          context: l.context ?? null,
        }),
      );
    }
    tx.ltrim(KEY, 0, MAX_HISTORY - 1);
    await exec(tx);
  }

  async list(offset = 0, limit = MAX_HISTORY) {
    const [total, raw] = await exec(
      this.redis
        .multi()
        .llen(KEY)
        .lrange(KEY, offset, offset + limit - 1),
    );
    return {
      rows: raw.map((r) => JSON.parse(r)),
      next: offset + limit < total ? String(offset + limit) : null,
    };
  }
}
