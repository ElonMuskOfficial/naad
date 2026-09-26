import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLrc, pickRecord } from '../../lib/lyrics.js';

describe('parseLrc', () => {
  it('parses stamps, multi-stamp lines and sorts them', () => {
    const lines = parseLrc('[ar: X]\n[00:12.50]Hello\n[01:02.3][00:05.00]Chorus\nno stamp');
    assert.deepEqual(lines, [
      { timeMs: 5000, text: 'Chorus' },
      { timeMs: 12_500, text: 'Hello' },
      { timeMs: 62_300, text: 'Chorus' },
    ]);
  });
});

describe('pickRecord', () => {
  const rec = (over) => ({
    trackName: 'Kesariya',
    artistName: 'Arijit Singh',
    duration: 268,
    syncedLyrics: '[00:01.00]x',
    plainLyrics: 'x',
    ...over,
  });

  it('takes the same song, preferring synced lyrics', () => {
    const plainOnly = rec({ syncedLyrics: null });
    const synced = rec({});
    assert.equal(pickRecord([plainOnly, synced], 'Kesariya', 'Arijit Singh', 268_000), synced);
  });

  it('rejects other songs, other artists and records without lyrics', () => {
    assert.equal(pickRecord([rec({ trackName: 'Kesariya (Remix)' })], 'Kesariya', 'Arijit Singh'), null);
    assert.equal(pickRecord([rec({ artistName: 'Somebody Else' })], 'Kesariya', 'Arijit Singh'), null);
    assert.equal(
      pickRecord([rec({ syncedLyrics: null, plainLyrics: null })], 'Kesariya', 'Arijit Singh'),
      null,
    );
  });

  it('rejects a version of clearly different length, but accepts a small gap', () => {
    assert.equal(pickRecord([rec({ duration: 400 })], 'Kesariya', 'Arijit Singh', 268_000), null);
    assert.notEqual(pickRecord([rec({ duration: 270 })], 'Kesariya', 'Arijit Singh', 268_000), null);
  });

  it('ignores accents, case and punctuation', () => {
    assert.notEqual(pickRecord([rec({ trackName: 'KESARIYA!' })], 'Kesariya', 'arijit  singh'), null);
  });
});
