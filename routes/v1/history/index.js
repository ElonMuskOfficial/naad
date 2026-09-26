import { ok } from '../../../lib/library/util.js';

const listenSchema = {
  type: 'object',
  required: ['trackId', 'startedAt', 'msPlayed'],
  properties: {
    trackId: { type: 'string', minLength: 3, maxLength: 64 },
    startedAt: { type: 'string', format: 'date-time' },
    msPlayed: { type: 'integer', minimum: 0, maximum: 86_400_000 },
    completed: { type: 'boolean' },
    context: {
      type: ['object', 'null'],
      properties: { type: { type: 'string', maxLength: 32 }, id: { type: 'string', maxLength: 64 } },
    },
    sourceProvider: { type: 'string', maxLength: 32 },
  },
};

/** Which songs the user played, for the History tab. Kept on the library Redis, newest 5000 only. */
const history = async (fastify) => {
  const { history: store, snapshots } = fastify.library;

  fastify.get(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
            cursor: { type: 'string', pattern: '^[0-9]{1,9}$' },
          },
        },
      },
    },
    async (req) => {
      const { rows, next } = await store.list(Number(req.query.cursor ?? 0), req.query.limit);
      const tracks = await snapshots.tracks(rows.map((r) => r.trackId));
      const items = rows.flatMap((r) => {
        const track = tracks.get(r.trackId);
        return track ? [{ playedAt: r.playedAt, msPlayed: r.msPlayed, track }] : [];
      });
      return { items, next };
    },
  );

  fastify.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['listens'],
          properties: { listens: { type: 'array', minItems: 1, maxItems: 100, items: listenSchema } },
        },
      },
    },
    async (req, reply) => {
      // Warm the track snapshots (best effort); a play is kept even if its track cannot be resolved right now.
      await snapshots.tracks(req.body.listens.map((l) => l.trackId));
      await store.append(req.body.listens);
      return ok(reply);
    },
  );
};

export default history;
