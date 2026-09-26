import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build, stubCatalog } from '../helper.js';

// JioSaavn's own ids can be short: the home feed links playlist 49 ("Dumdaar Hits").
describe('short JioSaavn ids', () => {
  it('are not rejected as invalid by the catalog routes', async (t) => {
    const app = await build(t);
    for (const url of ['/v1/playlists/49', '/v1/albums/49', '/v1/artists/49']) {
      const res = await app.inject(url);
      assert.notEqual(res.statusCode, 400, `${url} answered ${res.statusCode}: ${res.body}`);
    }
  });

  it('can be saved, followed and removed in the library', async (t) => {
    const app = stubCatalog(await build(t));
    for (const [kind, url] of [
      ['playlists', '/v1/library/playlists/49'],
      ['albums', '/v1/library/albums/49'],
      ['artists', '/v1/library/artists/49'],
    ]) {
      assert.equal((await app.inject({ method: 'PUT', url })).statusCode, 200, `PUT ${url}`);
      assert.equal((await app.inject({ method: 'DELETE', url })).statusCode, 200, `DELETE ${url}`);
      assert.deepEqual((await app.inject(`/v1/library/${kind}`)).json().items, [], kind);
    }
  });

  it('still rejects an empty or absurdly long id', async (t) => {
    const app = await build(t);
    assert.equal((await app.inject(`/v1/playlists/${'x'.repeat(65)}`)).statusCode, 400);
  });
});
