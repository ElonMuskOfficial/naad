import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build, stubCatalog } from '../helper.js';

/** Counts every command sent to a connection from now on (MULTI and EXEC count too). */
function countCommands(redis) {
  let n = 0;
  const send = redis.sendCommand.bind(redis);
  redis.sendCommand = (...args) => {
    n++;
    return send(...args);
  };
  return () => n;
}

const start = async (t) => stubCatalog(await build(t));
const call = (app, method, url, payload) => app.inject({ method, url, payload });

// A hosted free plan is billed per command (Upstash: 500K a month), and the sidebar and the like buttons run on
// every page load, so a request must cost a small constant number of commands whatever it lists.
describe('Redis command cost', () => {
  it('answers contains for 100 ids in at most 2 commands', async (t) => {
    const app = await start(t);
    const ids = Array.from({ length: 100 }, (_, i) => `track-${i}`);
    await call(app, 'PUT', '/v1/library/tracks', { trackIds: ids.slice(0, 50) });
    const used = countCommands(app.libraryRedis);
    const res = await app.inject(`/v1/library/tracks/contains?ids=${ids.join(',')}`);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      res.json(),
      ids.map((_, i) => i < 50),
    );
    assert.ok(used() <= 2, `used ${used()} commands`);
  });

  it('lists 6 own and 3 saved playlists in at most 3 commands', async (t) => {
    const app = await start(t);
    for (let i = 0; i < 6; i++) {
      await call(app, 'POST', '/v1/playlists', { title: `mine ${i}`, trackIds: ['track-a', 'track-b'] });
    }
    for (let i = 0; i < 3; i++) await call(app, 'PUT', `/v1/library/playlists/saved-${i}`);
    const used = countCommands(app.libraryRedis);
    const res = await app.inject('/v1/library/playlists');
    const items = res.json().items;
    assert.equal(items.length, 9);
    assert.deepEqual(
      items.slice(0, 6).map((p) => p.title),
      ['mine 5', 'mine 4', 'mine 3', 'mine 2', 'mine 1', 'mine 0'],
    );
    assert.ok(items.slice(0, 6).every((p) => p.trackCount === 2 && p.images.length > 0));
    assert.ok(used() <= 3, `used ${used()} commands`);
  });

  it('pages a collection in at most 2 commands, and still knows whether there is more', async (t) => {
    const app = await start(t);
    await call(app, 'PUT', '/v1/library/tracks', { trackIds: ['track-a', 'track-b', 'track-c'] });
    const used = countCommands(app.libraryRedis);
    const first = (await app.inject('/v1/library/tracks?limit=2')).json();
    assert.equal(first.items.length, 2);
    assert.equal(first.next, '2');
    assert.ok(used() <= 2, `used ${used()} commands`);
    const exact = (await app.inject('/v1/library/tracks?limit=3')).json();
    assert.equal(exact.items.length, 3);
    assert.equal(exact.next, null, 'a page that ends exactly at the end has no next');
  });
});
