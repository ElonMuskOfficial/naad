import { httpErrors } from '@fastify/sensible';

import { USER_PLAYLIST_ID } from '../../../lib/library/playlists.js';
import { ok } from '../../../lib/library/util.js';

// A playlist id can be short (JioSaavn's playlist 49 is on the home feed); track ids are not.
const id = { type: 'string', minLength: 1, maxLength: 64 };
const trackId = { type: 'string', minLength: 3, maxLength: 64 };
const params = { type: 'object', properties: { id } };
const itemParams = { type: 'object', properties: { id, itemId: id } };
const trackIds = { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: trackId };

/** JioSaavn playlists (read-only) and the user's own playlists (`usr_…` ids, in the library Redis). */
const playlists = async (fastify) => {
  const store = fastify.library.playlists;
  const user = async (playlistId) => {
    if (!USER_PLAYLIST_ID.test(playlistId)) throw httpErrors.notFound('Playlist not found');
    const view = await store.view(playlistId);
    if (!view) throw httpErrors.notFound('Playlist not found');
    return view;
  };

  fastify.get(
    '/:id',
    {
      schema: {
        params,
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 } },
        },
      },
    },
    async (req) => {
      if (USER_PLAYLIST_ID.test(req.params.id)) {
        const view = await user(req.params.id);
        const items = await store.items(req.params.id);
        return {
          ...view,
          tracks: items.map((i) => i.track),
          entries: items.map(({ itemId, addedAt }) => ({ itemId, addedAt })),
        };
      }
      const playlist = await fastify.catalog.getPlaylist(req.params.id, req.query.limit);
      // Best effort: the library being unreachable must not take JioSaavn playlists down with it.
      const [inLibrary] = await fastify.library.collections
        .contains('playlist', [req.params.id])
        .catch(() => [false]);
      return { ...playlist, origin: 'external', inLibrary };
    },
  );

  fastify.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: ['string', 'null'], maxLength: 2000 },
            trackIds: { ...trackIds, minItems: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      // Resolve first: JioSaavn failing must not leave a half-built playlist behind.
      const tracks = await Promise.all((req.body.trackIds ?? []).map((t) => fastify.catalog.getTrack(t)));
      const playlistId = await store.create({
        title: req.body.title,
        description: req.body.description,
        tracks,
      });
      return reply.code(201).send({ id: playlistId });
    },
  );

  fastify.patch(
    '/:id',
    {
      schema: {
        params,
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: ['string', 'null'], maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      await user(req.params.id);
      await store.update(req.params.id, req.body);
      return ok(reply);
    },
  );

  fastify.delete('/:id', { schema: { params } }, async (req, reply) => {
    await user(req.params.id);
    await store.remove(req.params.id);
    return ok(reply);
  });

  fastify.post(
    '/:id/items',
    {
      schema: {
        params,
        body: {
          type: 'object',
          required: ['trackIds'],
          properties: { trackIds, position: { type: 'string', enum: ['start', 'end'], default: 'end' } },
        },
      },
    },
    async (req, reply) => {
      await user(req.params.id);
      const tracks = await Promise.all(req.body.trackIds.map((t) => fastify.catalog.getTrack(t)));
      const itemIds = await store.addItems(req.params.id, tracks, req.body.position);
      return reply.code(201).send({ itemIds });
    },
  );

  fastify.delete(
    '/:id/items',
    {
      schema: { params, body: { type: 'object', required: ['itemIds'], properties: { itemIds: trackIds } } },
    },
    async (req, reply) => {
      await user(req.params.id);
      await store.removeItems(req.params.id, req.body.itemIds);
      return ok(reply);
    },
  );

  fastify.post(
    '/:id/items/:itemId/move',
    {
      schema: {
        params: itemParams,
        body: {
          type: 'object',
          required: ['afterItemId'],
          properties: { afterItemId: { type: ['string', 'null'] } },
        },
      },
    },
    async (req, reply) => {
      await user(req.params.id);
      await store.move(req.params.id, req.params.itemId, req.body.afterItemId);
      return ok(reply);
    },
  );
};

export default playlists;
