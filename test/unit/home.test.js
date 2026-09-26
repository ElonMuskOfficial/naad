import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sectionsFromLaunchData } from '../../lib/jiosaavn/home.js';
import { launchFixture } from '../helper.js';

describe('sectionsFromLaunchData', () => {
  const sections = sectionsFromLaunchData(launchFixture);

  it('follows the JioSaavn module order and titles', () => {
    assert.deepEqual(sections.map((s) => s.title).slice(0, 4), [
      'Trending Now',
      'Top Charts',
      'New Releases',
      'Editorial Picks',
    ]);
  });

  it('skips modules that cannot be rendered or played (podcasts, radio stations)', () => {
    const titles = sections.map((s) => s.title);
    for (const t of ['Trending Podcasts', 'Radio Stations', 'Recommended Artist Stations']) {
      assert.ok(!titles.includes(t), t);
    }
  });

  it('gives each section the kind of its most common item type, with matching item shapes', () => {
    const byId = new Map(sections.map((s) => [s.id, s]));
    assert.equal(byId.get('new-trending')?.kind, 'albums');
    assert.equal(byId.get('charts')?.kind, 'playlists');
    assert.equal(byId.get('promo-vx-data-113')?.kind, 'tracks');
    for (const s of sections) {
      assert.ok(s.items.length > 0);
      for (const item of s.items) assert.ok(item.id);
      if (s.kind === 'tracks') assert.ok('durationMs' in s.items[0]);
      if (s.kind === 'albums') assert.ok('albumType' in s.items[0]);
      if (s.kind === 'playlists') assert.ok('trackCount' in s.items[0]);
    }
  });

  it('uses native JioSaavn ids and decodes HTML entities in titles', () => {
    const tracks = sections.find((s) => s.kind === 'tracks');
    assert.doesNotMatch(tracks?.items[0]?.id ?? '', /^trk_/);
    for (const s of sections)
      for (const item of s.items) {
        const label = 'title' in item ? item.title : item.name;
        assert.doesNotMatch(label, /&quot;|&amp;/);
      }
  });

  it('fills album artists from the homepage artists list', () => {
    const albums = sections.find((s) => s.kind === 'albums');
    assert.ok(albums?.kind === 'albums' && albums.items.some((a) => a.artists.length > 0));
  });

  it('never contains personalised sections', () => {
    assert.ok(!sections.some((s) => /jump-back|on-repeat|because/.test(s.id)));
  });

  it('returns nothing for an empty response instead of throwing', () => {
    assert.deepEqual(sectionsFromLaunchData({}), []);
    assert.deepEqual(
      sectionsFromLaunchData({ modules: { a: { source: 'a', position: 1, title: 'A' } } }),
      [],
    );
  });
});
