import { httpErrors } from '@fastify/sensible';

import { USER_PLAYLIST_ID } from '../../../lib/library/playlists.js';
import { ok } from '../../../lib/library/util.js';

const id = { type: 'string', minLength: 3, maxLength: 64 };
// JioSaavn album, artist and playlist ids can be short (playlist 49 is on the home feed); track ids are not.
const anyId = { type: 'string', minLength: 1, maxLength: 64 };
const idParams = { type: 'object', properties: { id: anyId } };
const idList = { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: id };
const idsBody = { type: 'object', required: ['trackIds'], properties: { trackIds: idList } };
const pageQuery = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 500 },
    cursor: { type: 'string', pattern: '^[0-9]{1,9}$' },
  },
};
const offsetOf = (query) => Number(query.cursor ?? 0);

/** The user's library: liked tracks, saved albums, followed artists (playlists are added below). */
const library = async (fastify) => {
  const { collections } = fastify.library;

  // ---- liked tracks
  fastify.get('/tracks', { schema: { querystring: pageQuery } }, async (req) => {
    const { rows, next } = await collections.list('track', offsetOf(req.query), req.query.limit);
    return { items: rows.map((r) => ({ likedAt: r.at, track: r.snapshot })), next };
  });

  fastify.put('/tracks', { schema: { body: idsBody } }, async (req, reply) => {
    // Resolve everything first: JioSaavn failing must not leave half of the tracks liked.
    const tracks = await Promise.all(req.body.trackIds.map((trackId) => fastify.catalog.getTrack(trackId)));
    await collections.add(
      'track',
      tracks.map((track) => ({ id: track.id, snapshot: track })),
    );
    return ok(reply);
  });

  fastify.delete('/tracks', { schema: { body: idsBody } }, async (req, reply) => {
    await collections.remove('track', req.body.trackIds);
    return ok(reply);
  });

  fastify.get(
    '/tracks/contains',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['ids'],
          properties: { ids: { type: 'string', minLength: 1, maxLength: 6400 } },
        },
      },
    },
    async (req, reply) => {
      const ids = req.query.ids.split(',').filter(Boolean);
      if (ids.length < 1 || ids.length > 100) return reply.badRequest('ids must hold 1 to 100 ids');
      return collections.contains('track', ids);
    },
  );

  // ---- saved albums and followed artists share one shape of routes
  const resource = (path, kind, listKey, atKey, snapshotOf) => {
    fastify.get(`/${path}`, { schema: { querystring: pageQuery } }, async (req) => {
      const { rows, next } = await collections.list(kind, offsetOf(req.query), req.query.limit);
      return { items: rows.map((r) => ({ [atKey]: r.at, [listKey]: r.snapshot })), next };
    });
    fastify.put(`/${path}/:id`, { schema: { params: idParams } }, async (req, reply) => {
      const snapshot = await snapshotOf(req.params.id);
      await collections.add(kind, [{ id: snapshot.id, snapshot }]);
      return ok(reply);
    });
    fastify.delete(`/${path}/:id`, { schema: { params: idParams } }, async (req, reply) => {
      await collections.remove(kind, [req.params.id]);
      return ok(reply);
    });
  };

  resource('albums', 'album', 'album', 'savedAt', async (albumId) => {
    const { tracks: _tracks, ...album } = await fastify.catalog.getAlbum(albumId);
    return album;
  });
  resource('artists', 'artist', 'artist', 'followedAt', async (artistId) => {
    const { id: artistIdOut, name, images } = await fastify.catalog.getArtist(artistId);
    return { id: artistIdOut, name, images };
  });

  // ---- playlists: the user's own first, then saved JioSaavn ones
  fastify.get('/playlists', async () => {
    const own = await fastify.library.playlists.list();
    const { rows } = await collections.list('playlist');
    const saved = rows.map((r) => ({ ...r.snapshot, origin: 'external', inLibrary: true }));
    return { items: [...own, ...saved] };
  });

  fastify.put('/playlists/:id', { schema: { params: idParams } }, async (req, reply) => {
    if (USER_PLAYLIST_ID.test(req.params.id)) throw httpErrors.badRequest('That is already your playlist');
    const {
      id: playlistId,
      title,
      description,
      trackCount,
      images,
    } = await fastify.catalog.getPlaylist(req.params.id, 1);
    await collections.add('playlist', [
      { id: playlistId, snapshot: { id: playlistId, title, description, trackCount, images } },
    ]);
    return ok(reply);
  });

  fastify.delete('/playlists/:id', { schema: { params: idParams } }, async (req, reply) => {
    await collections.remove('playlist', [req.params.id]);
    return ok(reply);
  });

  /** Everything above as one document: the backup path for a library that lives in a single Redis. */
  fastify.get('/export', async (_req, reply) => {
    const { playlists, history, snapshots } = fastify.library;
    const [tracks, albums, artists, saved, own, plays] = await Promise.all([
      collections.list('track'),
      collections.list('album'),
      collections.list('artist'),
      collections.list('playlist'),
      playlists.list(),
      history.list(0),
    ]);
    const playTracks = await snapshots.tracks(plays.rows.map((r) => r.trackId));
    reply.header('content-disposition', 'attachment; filename="naad-library.json"');
    return {
      exportedAt: new Date().toISOString(),
      likedTracks: tracks.rows.map((r) => ({ likedAt: r.at, track: r.snapshot })),
      savedAlbums: albums.rows.map((r) => ({ savedAt: r.at, album: r.snapshot })),
      followedArtists: artists.rows.map((r) => ({ followedAt: r.at, artist: r.snapshot })),
      savedPlaylists: saved.rows.map((r) => ({ savedAt: r.at, playlist: r.snapshot })),
      playlists: await Promise.all(
        own.map(async (view) => ({ ...view, items: await playlists.items(view.id) })),
      ),
      history: plays.rows.flatMap((r) => {
        const track = playTracks.get(r.trackId);
        return track ? [{ playedAt: r.playedAt, msPlayed: r.msPlayed, track }] : [];
      }),
    };
  });
};

export default library;
