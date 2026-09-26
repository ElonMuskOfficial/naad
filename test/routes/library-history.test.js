import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { httpErrors } from '@fastify/sensible';
import { build, stubCatalog } from '../helper.js';

const start = async (t, opts) => stubCatalog(await build(t, opts));
const listen = (trackId, startedAt, extra = {}) => ({ trackId, startedAt, msPlayed: 61_000, ...extra });
const post = (app, listens) => app.inject({ method: 'POST', url: '/v1/history', payload: { listens } });

describe('history', () => {
  it('records plays and lists them newest first, whatever the batch order', async (t) => {
    const app = await start(t);
    const res = await post(app, [
      listen('track-b', '2026-09-26T10:05:00.000Z', { completed: true }),
      listen('track-a', '2026-09-26T10:00:00.000Z'),
    ]);
    assert.equal(res.statusCode, 200);
    await post(app, [
      listen('track-c', '2026-09-26T10:10:00.000Z', { context: { type: 'album', id: 'album-1' } }),
    ]);

    const { items, next } = (await app.inject('/v1/history')).json();
    assert.equal(next, null);
    assert.deepEqual(
      items.map((i) => i.track.id),
      ['track-c', 'track-b', 'track-a'],
    );
    assert.deepEqual([items[0].playedAt, items[0].msPlayed], ['2026-09-26T10:10:00.000Z', 61000]);
  });

  it('pages with a cursor', async (t) => {
    const app = await start(t);
    await post(
      app,
      ['a', 'b', 'c'].map((x, i) => listen(`track-${x}`, `2026-09-26T10:0${i}:00.000Z`)),
    );
    const first = (await app.inject('/v1/history?limit=2')).json();
    assert.equal(first.items.length, 2);
    assert.equal(first.next, '2');
    const second = (await app.inject(`/v1/history?limit=2&cursor=${first.next}`)).json();
    assert.deepEqual(
      second.items.map((i) => i.track.id),
      ['track-a'],
    );
    assert.equal(second.next, null);
  });

  it('keeps a play even when its track cannot be resolved now, and shows it once it can', async (t) => {
    const app = await build(t);
    const fail = new Set(['flaky-track']);
    stubCatalog(app, { fail });
    assert.equal((await post(app, [listen('flaky-track', '2026-09-26T10:00:00.000Z')])).statusCode, 200);
    assert.deepEqual((await app.inject('/v1/history')).json().items, []); // unresolved rows are skipped
    fail.clear();
    assert.deepEqual(
      (await app.inject('/v1/history')).json().items.map((i) => i.track.id),
      ['flaky-track'],
    );
  });

  it('trims to the newest 5000 plays', async (t) => {
    const app = await start(t);
    for (let from = 0; from < 5100; from += 100) {
      const batch = Array.from({ length: 100 }, (_, i) =>
        listen('track-a', new Date(Date.UTC(2026, 8, 1) + (from + i) * 1000).toISOString()),
      );
      assert.equal((await post(app, batch)).statusCode, 200);
    }
    assert.equal(await app.libraryRedis.llen('lib:history'), 5000);
    const newest = (await app.inject('/v1/history?limit=1')).json().items[0].playedAt;
    assert.equal(newest, new Date(Date.UTC(2026, 8, 1) + 5099 * 1000).toISOString());
  });

  it('rejects malformed plays with 400', async (t) => {
    const app = await start(t);
    assert.equal((await post(app, [])).statusCode, 400);
    assert.equal(
      (await post(app, [{ trackId: 'track-a', startedAt: 'yesterday', msPlayed: 1 }])).statusCode,
      400,
    );
    assert.equal(
      (await post(app, [listen('track-a', '2026-09-26T10:00:00.000Z', { msPlayed: -1 })])).statusCode,
      400,
    );
    const many = Array.from({ length: 101 }, () => listen('track-a', '2026-09-26T10:00:00.000Z'));
    assert.equal((await post(app, many)).statusCode, 400);
  });
});

describe('export', () => {
  it('returns the whole library as one document', async (t) => {
    const app = await start(t);
    await app.inject({ method: 'PUT', url: '/v1/library/tracks', payload: { trackIds: ['track-a'] } });
    await app.inject({ method: 'PUT', url: '/v1/library/albums/album-1' });
    await app.inject({ method: 'PUT', url: '/v1/library/artists/artist-1' });
    await app.inject({ method: 'PUT', url: '/v1/library/playlists/abc12345' });
    const created = await app.inject({
      method: 'POST',
      url: '/v1/playlists',
      payload: { title: 'mine', trackIds: ['track-b'] },
    });
    await post(app, [listen('track-c', '2026-09-26T10:00:00.000Z')]);

    const res = await app.inject('/v1/library/export');
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-disposition']), /attachment/);
    const doc = res.json();
    assert.match(doc.exportedAt, /^\d{4}-/);
    assert.deepEqual(
      doc.likedTracks.map((i) => i.track.id),
      ['track-a'],
    );
    assert.deepEqual(
      doc.savedAlbums.map((i) => i.album.id),
      ['album-1'],
    );
    assert.deepEqual(
      doc.followedArtists.map((i) => i.artist.id),
      ['artist-1'],
    );
    assert.deepEqual(
      doc.savedPlaylists.map((i) => i.playlist.id),
      ['abc12345'],
    );
    assert.deepEqual(
      doc.playlists.map((p) => [p.id, p.items.map((i) => i.track.id)]),
      [[created.json().id, ['track-b']]],
    );
    assert.deepEqual(
      doc.history.map((i) => i.track.id),
      ['track-c'],
    );
  });
});

describe('history lookups when JioSaavn cannot answer', () => {
  it('never fans out more than 8 lookups at once, nor more than 50 per request', async (t) => {
    const app = await build(t);
    let active = 0;
    let peak = 0;
    let calls = 0;
    app.catalog.getTrack = async () => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      throw httpErrors.badGateway('down');
    };
    const listens = Array.from({ length: 100 }, (_, i) =>
      listen(`dead-${i}`, new Date(Date.UTC(2026, 8, 1) + i * 1000).toISOString()),
    );

    assert.equal((await post(app, listens)).statusCode, 200);
    assert.ok(peak <= 8, `peak concurrency ${peak}`);
    assert.ok(calls <= 50, `${calls} lookups for one POST`);

    calls = 0;
    const res = await app.inject('/v1/history?limit=100');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().items, []);
    assert.ok(peak <= 8, `peak concurrency ${peak}`);
    assert.ok(calls <= 50, `${calls} lookups for one GET`);
  });
});
