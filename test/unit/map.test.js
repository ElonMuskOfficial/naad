import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { albumView, trackView } from '../../lib/jiosaavn/map.js';

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

  it('gives a null id, never the name, for a credited artist with no real JioSaavn id', () => {
    const song = {
      id: 's3',
      title: 'Some Song',
      more_info: {
        artistMap: {
          primary_artists: [{ name: 'No Id Here' }],
        },
      },
    };
    const track = trackView(song);
    assert.deepEqual(track.artists, [{ id: null, name: 'No Id Here' }]);
  });

  it('gives every credit a null id when falling back to the comma-separated subtitle', () => {
    const song = {
      id: 's4',
      title: 'Some Song',
      subtitle: 'Arijit Singh, Shreya Ghoshal - Movie Name',
      more_info: {},
    };
    const track = trackView(song);
    assert.deepEqual(track.artists, [
      { id: null, name: 'Arijit Singh' },
      { id: null, name: 'Shreya Ghoshal' },
    ]);
  });

  it('albumView also falls back to a null id via the same subtitle path', () => {
    const album = albumView({ id: 'a1', title: 'Some Album', subtitle: 'Some Artist' });
    assert.deepEqual(album.artists, [{ id: null, name: 'Some Artist' }]);
  });
});
