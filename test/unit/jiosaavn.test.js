import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decryptMedia, mediaVariant } from '../../lib/jiosaavn/audio.js';
import { images, trackView } from '../../lib/jiosaavn/map.js';
import { searchFixture } from '../helper.js';

describe('JioSaavn mapping', () => {
  const raw = searchFixture.results[0];

  it('decrypts the media URL into CDN variants', () => {
    const media = decryptMedia(raw);
    assert.match(media?.baseUrl ?? '', /^https:\/\/aac\.saavncdn\.com\/.+_96\.mp4$/);
    assert.equal(media?.has320, true);
    assert.match(mediaVariant(media, 320), /_320\.mp4$/);
  });

  it('maps songs with artists, album, duration and images', () => {
    const t = trackView(raw);
    assert.equal(t.title, 'Kesariya');
    assert.deepEqual(
      t.artists.map((a) => a.name),
      ['Pritam', 'Arijit Singh', 'Amitabh Bhattacharya'],
    );
    assert.equal(t.album?.title, 'Brahmastra');
    assert.equal(t.durationMs, 268_000);
    assert.match(t.images.at(-1)?.url ?? '', /500x500/);
  });

  it('builds all artwork sizes', () => {
    assert.deepEqual(
      images('https://c.saavncdn.com/x-150x150.jpg').map((i) => i.width),
      [50, 150, 500],
    );
  });
});
