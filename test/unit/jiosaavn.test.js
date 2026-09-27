import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decryptMedia, mediaVariant } from '../../lib/jiosaavn/audio.js';
import { episodeView, images, seasonView, showView, stationView, trackView } from '../../lib/jiosaavn/map.js';
import { browseFixture, searchFixture, showFixture, showSearchFixture } from '../helper.js';

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

describe('stationView', () => {
  const station = browseFixture.radio.featured_stations[0];

  it('maps a curated station, taking language from more_info', () => {
    const s = stationView(station);
    assert.equal(s.id, 'Desi Hip Hop');
    assert.equal(s.name, 'Desi Hip Hop');
    assert.equal(s.subtitle, 'Hindi Radio');
    assert.equal(s.language, 'hindi');
    assert.ok(s.images.length > 0);
  });
});

describe('showView', () => {
  it('maps a light browse-list entry (no description or episode count yet)', () => {
    const s = showView(browseFixture.top_shows.shows[0]);
    assert.equal(s.id, '62');
    // The token (not the plain id) is what `GET /v1/podcasts/{token}` needs — JioSaavn rejects the plain id.
    assert.equal(s.token, 'PjReFP-Sguk_');
    assert.equal(s.title, 'Talking Music');
    assert.equal(s.seasonNumber, 3);
    assert.equal(s.description, null);
    assert.equal(s.totalEpisodes, null);
  });

  it('maps the richer show_details, including host and description', () => {
    const s = showView(showFixture.show_details);
    assert.equal(s.id, '62');
    assert.equal(s.totalEpisodes, 41);
    assert.match(s.description ?? '', /Kirthi Shetty/);
    assert.deepEqual(
      s.artists.map((a) => a.name),
      ['Kirthi Shetty'],
    );
  });

  it('maps a search.getMoreResults hit — flat artists, image_file_url, latest_season_sequence', () => {
    const s = showView(showSearchFixture.results[0]);
    assert.equal(s.id, '62');
    assert.equal(s.token, 'PjReFP-Sguk_');
    assert.equal(s.title, 'Talking Music');
    assert.equal(s.seasonNumber, 3);
    assert.ok(s.images.length > 0);
    assert.deepEqual(
      s.artists.map((a) => a.name),
      ['Kirthi Shetty'],
    );
  });
});

describe('seasonView', () => {
  it('maps a season entry', () => {
    const s = seasonView(showFixture.seasons[0]);
    assert.equal(s.id, '1365');
    assert.equal(s.seasonNumber, 3);
    assert.equal(s.episodeCount, 41);
  });
});

describe('episodeView', () => {
  it('maps an episode, keeping season/episode numbers, duration and host/guest credits', () => {
    const e = episodeView(showFixture.episodes[0]);
    assert.equal(e.id, '3zKcXONr');
    assert.equal(e.title, 'Himesh Reshammiya');
    assert.equal(e.seasonNumber, 3);
    assert.equal(e.episodeNumber, 1);
    assert.equal(e.durationMs, 1_855_000);
    assert.deepEqual(
      e.artists.map((a) => a.name),
      ['Kirthi Shetty', 'Himesh Reshammiya'],
    );
  });

  it('falls back to the comma-separated subtitle when artistMap has no host/guest entries', () => {
    const e = episodeView(showFixture.episodes[1]);
    assert.deepEqual(
      e.artists.map((a) => a.name),
      ['Kirthi Shetty', 'Shankar Mahadevan', 'Ehsaan Noorani', 'Loy Mendonsa'],
    );
  });
});
