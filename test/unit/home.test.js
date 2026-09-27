import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sectionsFromLaunchData } from '../../lib/jiosaavn/home.js';
import { launchFixture } from '../helper.js';

describe('sectionsFromLaunchData', () => {
  const sections = sectionsFromLaunchData(launchFixture);
  const byId = new Map(sections.map((s) => [s.id, s]));

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

  // Regression test for the shelf-drops-minority-kinds bug: a module mixing item types must keep
  // every one of them, not just its most common kind.
  it('keeps every kind a mixed module holds, instead of collapsing to the most common one', () => {
    const trending = byId.get('new-trending');
    const kinds = new Set(trending?.items.map((i) => i.kind));
    assert.deepEqual(kinds, new Set(['album', 'playlist', 'track']));

    const newReleases = byId.get('new-albums');
    assert.deepEqual(
      new Set(newReleases?.items.map((i) => i.kind)),
      new Set(['track', 'album']),
    );
  });

  it('gives each item shape matching its own tagged kind', () => {
    for (const s of sections) {
      assert.ok(s.items.length > 0);
      for (const entry of s.items) {
        assert.ok(entry.item.id);
        if (entry.kind === 'track') assert.ok('durationMs' in entry.item);
        if (entry.kind === 'album') assert.ok('albumType' in entry.item);
        if (entry.kind === 'playlist') assert.ok('trackCount' in entry.item);
        if (entry.kind === 'artist') assert.ok('name' in entry.item);
      }
    }
  });

  it('preserves JioSaavn\'s own item order within a mixed section', () => {
    const raw = launchFixture.new_trending;
    const KIND_OF_TYPE = { song: 'track', album: 'album', playlist: 'playlist', artist: 'artist' };
    const expectedIds = raw.filter((r) => r.type && KIND_OF_TYPE[r.type]).map((r) => r.id);
    assert.deepEqual(
      byId.get('new-trending')?.items.map((i) => i.item.id),
      expectedIds,
    );
  });

  it('uses native JioSaavn ids and decodes HTML entities in titles', () => {
    const tracks = sections.flatMap((s) => s.items).filter((i) => i.kind === 'track');
    assert.ok(tracks.length > 0);
    assert.doesNotMatch(tracks[0].item.id, /^trk_/);
    for (const s of sections)
      for (const entry of s.items) {
        const label = 'title' in entry.item ? entry.item.title : entry.item.name;
        assert.doesNotMatch(label, /&quot;|&amp;/);
      }
  });

  it('fills album artists from the homepage artists list', () => {
    const albums = sections.flatMap((s) => s.items).filter((i) => i.kind === 'album');
    assert.ok(albums.some((a) => a.item.artists.length > 0));
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
