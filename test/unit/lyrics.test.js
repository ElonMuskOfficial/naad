import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LyricsService, parseLrc, pickRecord } from '../../lib/lyrics.js';

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

  it('takes the same song when it has synced lyrics', () => {
    const synced = rec({});
    assert.equal(pickRecord([synced], 'Kesariya', 'Arijit Singh', 268_000), synced);
  });

  it('rejects records without synced lyrics even if plain lyrics exist', () => {
    const plainOnly = rec({ syncedLyrics: null });
    assert.equal(pickRecord([plainOnly], 'Kesariya', 'Arijit Singh', 268_000), null);
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

describe('LyricsService synced lyrics', () => {
  const dummyCatalog = {
    getTrack: async (id) => ({
      id,
      title: 'Kesariya',
      artists: [{ name: 'Arijit Singh' }],
      album: { title: 'Brahmastra' },
      durationMs: 268_000,
    }),
  };

  const noCache = {
    wrap: async (_key, _ttl, fn) => fn(),
  };

  it('returns LRCLIB time-synced lyrics', async () => {
    const lrclibJson = async (url) => {
      if (url.includes('/api/get')) {
        return { syncedLyrics: '[00:05.00]Hello', plainLyrics: 'Hello' };
      }
      return [];
    };

    const svc = new LyricsService(dummyCatalog, lrclibJson, noCache);
    const res = await svc.get('trk1');
    assert.equal(res.source, 'lrclib');
    assert.deepEqual(res.synced, [{ timeMs: 5000, text: 'Hello' }]);
    assert.equal(res.plain, null);
  });

  it('throws 404 when LRCLIB has only plain lyrics', async () => {
    const lrclibJson = async (url) => {
      if (url.includes('/api/get')) {
        return { syncedLyrics: null, plainLyrics: 'Hello plain only' };
      }
      return [];
    };

    const svc = new LyricsService(dummyCatalog, lrclibJson, noCache);
    await assert.rejects(
      async () => svc.get('trk1'),
      (err) => err.statusCode === 404,
    );
  });

  it('throws 404 when LRCLIB has no lyrics at all', async () => {
    const lrclibJson = async (url) => {
      if (url.includes('/api/get')) {
        const err = new Error('not found');
        err.statusCode = 404;
        throw err;
      }
      return [];
    };

    const svc = new LyricsService(dummyCatalog, lrclibJson, noCache);
    await assert.rejects(
      async () => svc.get('trk1'),
      (err) => err.statusCode === 404,
    );
  });
});
