import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Audio } from '../../lib/jiosaavn/audio.js';

import { searchFixture } from '../helper.js';

const song = searchFixture.results[0];

/** An in-memory stand-in for the cache, and a client that counts song lookups. */
function setup(raw = song) {
  const store = new Map();
  const cache = {
    get: async (k) => store.get(k),
    set: async (k, v) => void store.set(k, v),
  };
  let lookups = 0;
  const jiosaavn = {
    getSongRaw: async () => {
      lookups++;
      return raw;
    },
  };
  return { audio: new Audio(jiosaavn, cache), lookups: () => lookups };
}

describe('Audio', () => {
  it('picks 320 kbps for max when the song has it', async () => {
    const info = await setup().audio.get('rjkrTnma');
    assert.equal(info.bitrateKbps, 320);
    assert.match(info.url, /^https:\/\/aac\.saavncdn\.com\/.+_320\.mp4$/);
    assert.equal(info.durationMs, 268_000);
  });

  it('falls back to 160 kbps when the song has no 320 kbps file', async () => {
    const { audio } = setup({ ...song, more_info: { ...song.more_info, '320kbps': 'false' } });
    assert.equal((await audio.get('x', 'max')).bitrateKbps, 160);
    assert.equal((await audio.get('x', '320')).bitrateKbps, 160);
  });

  it('honours an explicit lower bitrate', async () => {
    const { audio } = setup();
    assert.match((await audio.get('x', '160')).url, /_160\.mp4$/);
    assert.match((await audio.get('x', '96')).url, /_96\.mp4$/);
  });

  it('looks a song up once, then serves it from the cache until refreshed', async () => {
    const { audio, lookups } = setup();
    await audio.get('x');
    await audio.get('x', '96');
    assert.equal(lookups(), 1);
    await audio.get('x', 'max', true);
    assert.equal(lookups(), 2);
  });

  it('reports a song without audio as not found', async () => {
    const { audio } = setup({ ...song, more_info: { ...song.more_info, encrypted_media_url: '' } });
    await assert.rejects(audio.get('x'), { statusCode: 404 });
  });
});
