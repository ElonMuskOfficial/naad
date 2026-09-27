import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Catalog } from '../../lib/jiosaavn/catalog.js';

// naad is a data clone of JioSaavn's catalog: field names and nesting may be reshaped for the frontend, but
// the actual data — values and order — must come through exactly as JioSaavn returned it. No relevance
// scoring, no re-ranking, no picking a "better" result out of order.
function catalogWith(parts) {
  const jiosaavn = { search: async () => ({ ...parts, failed: false }) };
  const cache = { wrap: async (_key, _ttl, fn) => fn(), get: async () => undefined, set: async () => {} };
  return new Catalog(jiosaavn, cache);
}

describe('search does not re-rank JioSaavn results', () => {
  it('keeps tracks in exactly the order JioSaavn returned, even when that is not "most relevant first"', async () => {
    // The least title-relevant entry ("Unrelated Jam") comes first on purpose: JioSaavn's own order is
    // whatever it is (popularity, editorial, ...) and naad must not reshuffle it toward a "better" match.
    const tracks = [
      { id: 't1', title: 'Unrelated Jam', artists: [], images: [] },
      { id: 't2', title: 'Kesariya (Sitar Cover)', artists: [{ id: 'a2', name: 'Nobody' }], images: [] },
      { id: 't3', title: 'Kesariya', artists: [{ id: 'a1', name: 'Arijit Singh' }], images: [] },
    ];
    const catalog = catalogWith({ tracks, albums: [], artists: [], playlists: [] });
    const res = await catalog.search('kesariya arijit', ['track'], 20, 0);
    assert.deepEqual(
      res.tracks.map((t) => t.id),
      ['t1', 't2', 't3'],
    );
  });

  it('keeps albums and artists in JioSaavn order too', async () => {
    const albums = [
      { id: 'al1', title: 'Z Album', artists: [], images: [] },
      { id: 'al2', title: 'A Album', artists: [], images: [] },
    ];
    const artists = [
      { id: 'ar1', name: 'Z Artist', images: [] },
      { id: 'ar2', name: 'A Artist', images: [] },
    ];
    const catalog = catalogWith({ tracks: [], albums, artists, playlists: [] });
    const res = await catalog.search('a', ['album', 'artist'], 20, 0);
    assert.deepEqual(
      res.albums.map((a) => a.id),
      ['al1', 'al2'],
    );
    assert.deepEqual(
      res.artists.map((a) => a.id),
      ['ar1', 'ar2'],
    );
  });

  it('picks topResult positionally (first track, else first artist, else first album) with no scoring', async () => {
    const tracks = [{ id: 't1', title: 'Whatever JioSaavn Put First', artists: [], images: [] }];
    const artists = [{ id: 'ar1', name: 'Some Artist', images: [] }];
    const catalog = catalogWith({ tracks, albums: [], artists, playlists: [] });
    const res = await catalog.search('anything', ['track', 'artist'], 20, 0);
    assert.equal(res.topResult.type, 'track');
    assert.equal(res.topResult.item.id, 't1');
  });

  it('falls back to the first artist for topResult when there are no tracks', async () => {
    const artists = [{ id: 'ar1', name: 'Some Artist', images: [] }];
    const albums = [{ id: 'al1', title: 'Some Album', artists: [], images: [] }];
    const catalog = catalogWith({ tracks: [], albums, artists, playlists: [] });
    const res = await catalog.search('anything', ['artist', 'album'], 20, 0);
    assert.equal(res.topResult.type, 'artist');
    assert.equal(res.topResult.item.id, 'ar1');
  });
});
