import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build, stubCatalog } from '../helper.js';

const start = async (t, opts) => stubCatalog(await build(t, opts));
const call = (app, method, url, payload) => app.inject({ method, url, payload });

/** @param {{ title: string, description?: string, trackIds?: string[] }} [body] */
async function createPlaylist(
  app,
  body = { title: 'Road trip', trackIds: ['track-a', 'track-b', 'track-c'] },
) {
  const res = await call(app, 'POST', '/v1/playlists', body);
  assert.equal(res.statusCode, 201);
  return res.json().id;
}
const readItems = async (app, id) => (await app.inject(`/v1/playlists/${id}`)).json();
const order = async (app, id) => (await readItems(app, id)).tracks.map((t) => t.id);

describe('user playlists', () => {
  it('creates, reads and lists a playlist', async (t) => {
    const app = await start(t);
    const id = await createPlaylist(app, {
      title: 'Road trip',
      description: 'Long drives',
      trackIds: ['track-a', 'track-b'],
    });
    assert.match(id, /^usr_[0-9a-f-]{36}$/);

    const pl = await readItems(app, id);
    assert.equal(pl.title, 'Road trip');
    assert.equal(pl.description, 'Long drives');
    assert.equal(pl.origin, 'user');
    assert.equal(pl.inLibrary, true);
    assert.equal(pl.trackCount, 2);
    assert.deepEqual(
      pl.tracks.map((x) => x.id),
      ['track-a', 'track-b'],
    );
    assert.equal(pl.entries.length, 2);
    assert.match(pl.entries[0].itemId, /^[0-9a-f-]{36}$/);
    assert.match(pl.entries[0].addedAt, /^\d{4}-/);

    const list = (await app.inject('/v1/library/playlists')).json().items;
    assert.deepEqual(
      list.map((p) => [p.id, p.origin, p.inLibrary, p.trackCount]),
      [[id, 'user', true, 2]],
    );
    assert.deepEqual(list[0].images, pl.tracks[0].images);
  });

  it('creates an empty playlist and nulls an empty description', async (t) => {
    const app = await start(t);
    const id = await createPlaylist(app, { title: 'Empty', description: '' });
    const pl = await readItems(app, id);
    assert.deepEqual([pl.tracks, pl.description, pl.trackCount], [[], null, 0]);
  });

  it('renames and deletes, and is 404 afterwards', async (t) => {
    const app = await start(t);
    const id = await createPlaylist(app);
    assert.equal((await call(app, 'PATCH', `/v1/playlists/${id}`, { title: 'Renamed' })).statusCode, 200);
    assert.equal((await readItems(app, id)).title, 'Renamed');
    assert.equal((await call(app, 'DELETE', `/v1/playlists/${id}`)).statusCode, 200);
    assert.equal((await app.inject(`/v1/playlists/${id}`)).statusCode, 404);
    assert.deepEqual((await app.inject('/v1/library/playlists')).json().items, []);
    assert.equal((await call(app, 'PATCH', `/v1/playlists/${id}`, { title: 'x' })).statusCode, 404);
  });

  it('adds tracks at the end or the start, duplicates get their own item ids', async (t) => {
    const app = await start(t);
    const id = await createPlaylist(app, { title: 'p', trackIds: ['track-a'] });
    const end = await call(app, 'POST', `/v1/playlists/${id}/items`, { trackIds: ['track-b', 'track-a'] });
    assert.equal(end.statusCode, 201);
    assert.equal(end.json().itemIds.length, 2);
    await call(app, 'POST', `/v1/playlists/${id}/items`, { trackIds: ['track-z'], position: 'start' });
    const pl = await readItems(app, id);
    assert.deepEqual(
      pl.tracks.map((x) => x.id),
      ['track-z', 'track-a', 'track-b', 'track-a'],
    );
    assert.equal(new Set(pl.entries.map((e) => e.itemId)).size, 4);
    assert.equal(pl.trackCount, 4);
  });

  it('removes items, and removing one twice is harmless', async (t) => {
    const app = await start(t);
    const id = await createPlaylist(app);
    const [a, b] = (await readItems(app, id)).entries.map((e) => e.itemId);
    assert.equal((await call(app, 'DELETE', `/v1/playlists/${id}/items`, { itemIds: [a] })).statusCode, 200);
    assert.equal(
      (await call(app, 'DELETE', `/v1/playlists/${id}/items`, { itemIds: [a, b] })).statusCode,
      200,
    );
    assert.deepEqual(await order(app, id), ['track-c']);
  });

  it('caps a playlist at 1000 tracks', async (t) => {
    const app = await start(t);
    const id = await createPlaylist(app, { title: 'big' });
    for (let i = 0; i < 10; i++) {
      const trackIds = Array.from({ length: 100 }, (_, n) => `track-${i}-${n}`);
      assert.equal((await call(app, 'POST', `/v1/playlists/${id}/items`, { trackIds })).statusCode, 201);
    }
    assert.equal(
      (await call(app, 'POST', `/v1/playlists/${id}/items`, { trackIds: ['one-more'] })).statusCode,
      400,
    );
    assert.equal((await readItems(app, id)).trackCount, 1000);
  });

  it('writes nothing when a track cannot be resolved (Review Focus 2)', async (t) => {
    const app = await build(t);
    stubCatalog(app, { fail: new Set(['bad-track']) });
    const res = await call(app, 'POST', '/v1/playlists', { title: 'x', trackIds: ['track-a', 'bad-track'] });
    assert.equal(res.statusCode, 502);
    assert.deepEqual((await app.inject('/v1/library/playlists')).json().items, []);
    const id = await createPlaylist(app, { title: 'ok', trackIds: ['track-a'] });
    const add = await call(app, 'POST', `/v1/playlists/${id}/items`, { trackIds: ['track-b', 'bad-track'] });
    assert.equal(add.statusCode, 502);
    assert.deepEqual(await order(app, id), ['track-a']);
  });

  it('rejects malformed input with 400', async (t) => {
    const app = await start(t);
    assert.equal((await call(app, 'POST', '/v1/playlists', { title: '' })).statusCode, 400);
    assert.equal((await call(app, 'POST', '/v1/playlists', {})).statusCode, 400);
    const id = await createPlaylist(app);
    assert.equal((await call(app, 'PATCH', `/v1/playlists/${id}`, {})).statusCode, 400);
    assert.equal((await call(app, 'POST', `/v1/playlists/${id}/items`, { trackIds: [] })).statusCode, 400);
  });
});

describe('reordering (Review Focus 3)', () => {
  const setup = async (t) => {
    const app = await start(t);
    const id = await createPlaylist(app, {
      title: 'p',
      trackIds: ['track-a', 'track-b', 'track-c', 'track-d'],
    });
    const items = (await readItems(app, id)).entries.map((e) => e.itemId);
    const move = (itemId, afterItemId) =>
      call(app, 'POST', `/v1/playlists/${id}/items/${itemId}/move`, { afterItemId });
    return { app, id, items, move };
  };

  it('moves to the front, the middle and the end', async (t) => {
    const { app, id, items, move } = await setup(t);
    assert.equal((await move(items[2], null)).statusCode, 200); // c to front
    assert.deepEqual(await order(app, id), ['track-c', 'track-a', 'track-b', 'track-d']);
    assert.equal((await move(items[0], items[1])).statusCode, 200); // a after b
    assert.deepEqual(await order(app, id), ['track-c', 'track-b', 'track-a', 'track-d']);
    assert.equal((await move(items[2], items[3])).statusCode, 200); // c to the end
    assert.deepEqual(await order(app, id), ['track-b', 'track-a', 'track-d', 'track-c']);
  });

  it('treats a move after itself as a no-op', async (t) => {
    const { app, id, items, move } = await setup(t);
    assert.equal((await move(items[1], items[1])).statusCode, 200);
    assert.deepEqual(await order(app, id), ['track-a', 'track-b', 'track-c', 'track-d']);
  });

  it('answers 404 and changes nothing for an unknown item or a stale afterItemId', async (t) => {
    const { app, id, items, move } = await setup(t);
    await call(app, 'DELETE', `/v1/playlists/${id}/items`, { itemIds: [items[3]] });
    assert.equal((await move(items[0], items[3])).statusCode, 404); // after a removed item
    assert.equal((await move(items[3], null)).statusCode, 404); // moving a removed item
    assert.equal((await move('00000000-0000-4000-8000-000000000000', null)).statusCode, 404);
    assert.deepEqual(await order(app, id), ['track-a', 'track-b', 'track-c']);
  });
});

describe('ids that are not user playlists (Review Focus 4)', () => {
  it('is 404 for an unknown usr_ id without asking JioSaavn', async (t) => {
    const app = await start(t);
    app.catalog.getPlaylist = async () => {
      throw new Error('upstream must not be called for a usr_ id');
    };
    const res = await app.inject('/v1/playlists/usr_00000000-0000-4000-8000-000000000000');
    assert.equal(res.statusCode, 404);
  });

  it('never mutates or deletes a JioSaavn playlist id', async (t) => {
    const app = await start(t);
    assert.equal((await call(app, 'PATCH', '/v1/playlists/abc12345', { title: 'x' })).statusCode, 404);
    assert.equal((await call(app, 'DELETE', '/v1/playlists/abc12345')).statusCode, 404);
    assert.equal(
      (await call(app, 'POST', '/v1/playlists/abc12345/items', { trackIds: ['track-a'] })).statusCode,
      404,
    );
  });

  it('serves a JioSaavn playlist as external, with its library state', async (t) => {
    const app = await start(t);
    const before = (await app.inject('/v1/playlists/abc12345')).json();
    assert.deepEqual(
      [before.origin, before.inLibrary, before.title],
      ['external', false, 'Playlist abc12345'],
    );
    assert.equal('entries' in before, false);

    assert.equal((await call(app, 'PUT', '/v1/library/playlists/abc12345')).statusCode, 200);
    assert.equal((await app.inject('/v1/playlists/abc12345')).json().inLibrary, true);
    const list = (await app.inject('/v1/library/playlists')).json().items;
    assert.deepEqual(
      list.map((p) => [p.id, p.origin, p.inLibrary]),
      [['abc12345', 'external', true]],
    );
    assert.equal('tracks' in list[0], false);

    assert.equal((await call(app, 'DELETE', '/v1/library/playlists/abc12345')).statusCode, 200);
    assert.deepEqual((await app.inject('/v1/library/playlists')).json().items, []);
  });

  it('refuses to "save" a user playlist as if it were external', async (t) => {
    const app = await start(t);
    const id = await createPlaylist(app);
    assert.equal((await call(app, 'PUT', `/v1/library/playlists/${id}`)).statusCode, 400);
  });

  it('lists user playlists before saved external ones', async (t) => {
    const app = await start(t);
    await call(app, 'PUT', '/v1/library/playlists/abc12345');
    const id = await createPlaylist(app, { title: 'mine' });
    assert.deepEqual(
      (await app.inject('/v1/library/playlists')).json().items.map((p) => p.id),
      [id, 'abc12345'],
    );
  });

  it('still serves a JioSaavn playlist when the library Redis is down (Review Focus 5)', async (t) => {
    const app = await start(t);
    app.libraryRedis.disconnect();
    const res = await app.inject('/v1/playlists/abc12345');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().inLibrary, false);
  });
});
