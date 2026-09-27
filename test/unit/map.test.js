import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trackView } from '../../lib/jiosaavn/map.js';

describe('trackView artist credits', () => {
  it('keeps every credited artist in JioSaavn order, duplicates included — no de-duplication', () => {
    const song = {
      id: 's1',
      title: 'Some Song',
      more_info: {
        artistMap: {
          primary_artists: [{ id: '1', name: 'Arijit Singh' }],
          // Same artist listed again under featured_artists (a real JioSaavn data quirk) — must still
          // come through twice, in order, since naad clones the data rather than curating it.
          featured_artists: [{ id: '1', name: 'Arijit Singh' }],
        },
      },
    };
    const track = trackView(song);
    assert.deepEqual(
      track.artists.map((a) => a.id),
      ['1', '1'],
    );
  });

  it('keeps primary artists before featured artists, each in their own listed order', () => {
    const song = {
      id: 's2',
      title: 'Some Song',
      more_info: {
        artistMap: {
          primary_artists: [
            { id: '2', name: 'Second Primary' },
            { id: '1', name: 'First Primary' },
          ],
          featured_artists: [{ id: '3', name: 'A Featured Artist' }],
        },
      },
    };
    const track = trackView(song);
    assert.deepEqual(
      track.artists.map((a) => a.id),
      ['2', '1', '3'],
    );
  });
});
