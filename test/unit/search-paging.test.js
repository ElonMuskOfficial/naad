import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Catalog } from '../../lib/jiosaavn/catalog.js';

// JioSaavn returns at most 40 results per call (`n` is capped) but has many more pages (`p`). To serve any offset the
// catalog builds its window from as many upstream pages as needed, and asks for one result more than the page it
// serves: that extra one is how it knows a next page exists.
function catalogWith(available) {
  const calls = [];
  const song = (i) => ({ id: `s${i}`, title: `Song ${i}`, artists: [], images: [] });
  const jiosaavn = {
    search: async (_q, _types, { limit, page = 1 }) => {
      calls.push({ limit, page });
      const n = Math.min(limit, 40); // the real cap
      const start = (page - 1) * n;
      const count = Math.max(0, Math.min(n, available - start));
      return { tracks: Array.from({ length: count }, (_, i) => song(start + i)) };
    },
  };
  const cache = { wrap: async (_key, _ttl, fn) => fn(), get: async () => undefined, set: async () => {} };
  return { catalog: new Catalog(jiosaavn, cache), calls };
}

describe('search paging', () => {
  it('announces a next page at the default page size when JioSaavn has more, with one upstream call', async () => {
    const { catalog, calls } = catalogWith(5000);
    const res = await catalog.search('song', ['track'], 20, 0);
    assert.equal(res.tracks.length, 20);
    assert.equal(res.nextOffset, 20);
    assert.equal(calls.length, 1);
  });

  it('serves the second page from a second upstream page', async () => {
    const { catalog } = catalogWith(5000);
    const res = await catalog.search('song', ['track'], 20, 20);
    assert.equal(res.tracks.length, 20);
    assert.equal(res.tracks[0].title, 'Song 20');
    assert.equal(res.nextOffset, 40);
  });

  it('goes far beyond the 40 results one JioSaavn call can return', async () => {
    const { catalog, calls } = catalogWith(5000);
    const res = await catalog.search('song', ['track'], 20, 100);
    assert.equal(res.tracks.length, 20);
    assert.equal(res.tracks[0].title, 'Song 100');
    assert.equal(res.tracks[19].title, 'Song 119');
    assert.equal(res.nextOffset, 120);
    assert.ok(
      calls.every((c) => c.limit <= 40),
      'never asks for more than JioSaavn allows per call',
    );
  });

  it('says there is no next page once JioSaavn has nothing more', async () => {
    const { catalog } = catalogWith(35);
    const res = await catalog.search('song', ['track'], 20, 20);
    assert.equal(res.tracks.length, 15);
    assert.equal(res.nextOffset, null);
  });

  it('has no next page when the results end exactly at the page boundary', async () => {
    const { catalog } = catalogWith(20);
    const res = await catalog.search('song', ['track'], 20, 0);
    assert.equal(res.tracks.length, 20);
    assert.equal(res.nextOffset, null);
  });

  it('returns an empty page past the end instead of failing', async () => {
    const { catalog } = catalogWith(30);
    const res = await catalog.search('song', ['track'], 20, 60);
    assert.deepEqual(res.tracks, []);
    assert.equal(res.nextOffset, null);
  });

  it('keeps small pages working', async () => {
    const { catalog } = catalogWith(5000);
    const res = await catalog.search('song', ['track'], 5, 0);
    assert.equal(res.tracks.length, 5);
    assert.equal(res.nextOffset, 5);
  });
});
