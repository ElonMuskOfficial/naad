import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Podcasts } from '../../lib/jiosaavn/podcasts.js';
import { Stations } from '../../lib/jiosaavn/stations.js';
import { browseFixture, showFixture } from '../helper.js';

describe('Stations', () => {
  it('browses the featured stations from a browseModules response, dropping id-less "artist radio" presets', async () => {
    // browseFixture also carries two artist-radio presets (empty id, empty perma_url — JioSaavn's "resolve
    // by artist name" entries) mixed into featured_stations. Left in, their shared empty id is a duplicate
    // list key on the client and crashes its rendering.
    const stations = new Stations({ browseModules: async () => browseFixture });
    const list = await stations.browse('hindi');
    assert.deepEqual(
      list.map((s) => s.id),
      ['Desi Hip Hop', 'Workout Karo'],
    );
  });

  it('is an empty list, not a throw, when the response has no radio module', async () => {
    const stations = new Stations({ browseModules: async () => ({}) });
    assert.deepEqual(await stations.browse('hindi'), []);
  });

  it('create and songs delegate straight through to the client', async () => {
    let created;
    const stations = new Stations({
      createStation: async (name, language) => {
        created = { name, language };
        return 'station-1';
      },
      getStationSongs: async (id, limit) => [{ id: `${id}:${limit}` }],
    });
    assert.equal(await stations.create('Desi Hip Hop', 'hindi'), 'station-1');
    assert.deepEqual(created, { name: 'Desi Hip Hop', language: 'hindi' });
    assert.deepEqual(await stations.songs('station-1', 5), [{ id: 'station-1:5' }]);
  });
});

describe('Podcasts', () => {
  it('browses the show catalog from a browseModules response', async () => {
    const podcasts = new Podcasts({ browseModules: async () => browseFixture });
    const list = await podcasts.browse('hindi');
    assert.deepEqual(
      list.map((s) => s.id),
      ['62', '175427'],
    );
  });

  it('is an empty list, not a throw, when the response has no top_shows module', async () => {
    const podcasts = new Podcasts({ browseModules: async () => ({}) });
    assert.deepEqual(await podcasts.browse('hindi'), []);
  });

  it('getShow delegates straight through to the client', async () => {
    const podcasts = new Podcasts({ getShow: async (token, season) => ({ token, season }) });
    assert.deepEqual(await podcasts.getShow('PjReFP-Sguk_', 3), { token: 'PjReFP-Sguk_', season: 3 });
  });
});

// Sanity check that the fixture the classes above use is consistent with the real `webapi.get` shape
// exercised in test/routes/stations-podcasts.test.js.
describe('show fixture', () => {
  it('has the show_details, seasons and episodes a real response has', () => {
    assert.ok(showFixture.show_details);
    assert.ok(showFixture.seasons.length > 0);
    assert.ok(showFixture.episodes.length > 0);
  });
});
