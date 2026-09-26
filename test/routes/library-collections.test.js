import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { build, stubCatalog } from '../helper.js';

const put = (app, url, payload) => app.inject({ method: 'PUT', url, payload });
const del = (app, url, payload) => app.inject({ method: 'DELETE', url, payload });
const start = async (t, opts) => stubCatalog(await build(t, opts));

describe('liked tracks', () => {
  it('lists newest first and is idempotent', async (t) => {
    const app = await start(t);
    assert.equal((await put(app, '/v1/library/tracks', { trackIds: ['track-a'] })).statusCode, 200);
    await sleep(5);
    assert.equal(
      (await put(app, '/v1/library/tracks', { trackIds: ['track-b', 'track-c'] })).statusCode,
      200,
    );
    await sleep(5);
    await put(app, '/v1/library/tracks', { trackIds: ['track-a'] }); // already liked: keeps its time

    const res = await app.inject('/v1/library/tracks');
    assert.equal(res.statusCode, 200);
    const { items, next } = res.json();
    assert.equal(next, null);
    assert.deepEqual(
      items.map((i) => i.track.id),
      ['track-c', 'track-b', 'track-a'],
    );
    assert.match(items[0].likedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(items[0].track.title, 'Track track-c');
  });

  it('answers contains aligned to the ids asked for', async (t) => {
    const app = await start(t);
    await put(app, '/v1/library/tracks', { trackIds: ['track-a', 'track-c'] });
    const res = await app.inject('/v1/library/tracks/contains?ids=track-a,track-b,track-c');
    assert.deepEqual(res.json(), [true, false, true]);
  });

  it('unlikes, also things that were never liked', async (t) => {
    const app = await start(t);
    await put(app, '/v1/library/tracks', { trackIds: ['track-a', 'track-b'] });
    assert.equal(
      (await del(app, '/v1/library/tracks', { trackIds: ['track-a', 'never-liked'] })).statusCode,
      200,
    );
    const ids = (await app.inject('/v1/library/tracks')).json().items.map((i) => i.track.id);
    assert.deepEqual(ids, ['track-b']);
  });

  it('pages with an opaque cursor', async (t) => {
    const app = await start(t);
    for (const id of ['track-a', 'track-b', 'track-c']) {
      await put(app, '/v1/library/tracks', { trackIds: [id] });
      await sleep(3);
    }
    const first = (await app.inject('/v1/library/tracks?limit=2')).json();
    assert.deepEqual(
      first.items.map((i) => i.track.id),
      ['track-c', 'track-b'],
    );
    assert.equal(first.next, '2');
    const second = (await app.inject(`/v1/library/tracks?limit=2&cursor=${first.next}`)).json();
    assert.deepEqual(
      second.items.map((i) => i.track.id),
      ['track-a'],
    );
    assert.equal(second.next, null);
  });

  it('writes nothing when one track cannot be resolved (Review Focus 2)', async (t) => {
    const app = await build(t);
    stubCatalog(app, { fail: new Set(['bad-track']) });
    const res = await put(app, '/v1/library/tracks', { trackIds: ['track-a', 'bad-track'] });
    assert.equal(res.statusCode, 502);
    assert.deepEqual((await app.inject('/v1/library/tracks')).json().items, []);
  });

  it('rejects malformed input with 400', async (t) => {
    const app = await start(t);
    assert.equal((await put(app, '/v1/library/tracks', { trackIds: [] })).statusCode, 400);
    assert.equal((await put(app, '/v1/library/tracks', {})).statusCode, 400);
    const tooMany = Array.from({ length: 101 }, (_, i) => `track-${i}`);
    assert.equal((await put(app, '/v1/library/tracks', { trackIds: tooMany })).statusCode, 400);
    assert.equal((await app.inject(`/v1/library/tracks/contains?ids=${tooMany.join(',')}`)).statusCode, 400);
    assert.equal((await app.inject('/v1/library/tracks?cursor=abc')).statusCode, 400);
    assert.equal((await app.inject('/v1/library/tracks?limit=0')).statusCode, 400);
  });

  it('needs the API key', async (t) => {
    const app = await start(t, { env: { NAAD_API_KEY: 'secret-key-123' } });
    assert.equal((await app.inject('/v1/library/tracks')).statusCode, 401);
    const ok = await app.inject({
      url: '/v1/library/tracks',
      headers: { authorization: 'Bearer secret-key-123' },
    });
    assert.equal(ok.statusCode, 200);
  });
});

describe('saved albums and followed artists', () => {
  it('saves, lists and removes an album', async (t) => {
    const app = await start(t);
    assert.equal((await put(app, '/v1/library/albums/album-1')).statusCode, 200);
    const { items } = (await app.inject('/v1/library/albums')).json();
    assert.equal(items.length, 1);
    assert.equal(items[0].album.id, 'album-1');
    assert.equal(items[0].album.title, 'Album album-1');
    assert.equal('tracks' in items[0].album, false, 'the snapshot is the album, not its tracks');
    assert.match(items[0].savedAt, /^\d{4}-/);
    assert.equal((await del(app, '/v1/library/albums/album-1')).statusCode, 200);
    assert.deepEqual((await app.inject('/v1/library/albums')).json().items, []);
  });

  it('follows, lists and unfollows an artist', async (t) => {
    const app = await start(t);
    assert.equal((await put(app, '/v1/library/artists/artist-1')).statusCode, 200);
    const { items } = (await app.inject('/v1/library/artists')).json();
    assert.deepEqual(
      items.map((i) => [i.artist.id, i.artist.name]),
      [['artist-1', 'Artist artist-1']],
    );
    assert.match(items[0].followedAt, /^\d{4}-/);
    assert.equal('topTracks' in items[0].artist, false);
    await del(app, '/v1/library/artists/artist-1');
    assert.deepEqual((await app.inject('/v1/library/artists')).json().items, []);
  });
});

describe('where the data lives', () => {
  it('keeps every library key out of the cache Redis (Review Focus 1)', async (t) => {
    const app = await start(t);
    assert.notEqual(app.libraryRedis, app.redis);
    await put(app, '/v1/library/tracks', { trackIds: ['track-a'] });
    await put(app, '/v1/library/albums/album-1');
    assert.deepEqual(await app.redis.keys('lib:*'), []);
    assert.ok((await app.libraryRedis.keys('lib:*')).length >= 2);
  });
});
