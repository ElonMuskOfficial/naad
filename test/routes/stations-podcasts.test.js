import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build, fakeUpstream } from '../helper.js';

describe("radio stations (JioSaavn's own curated catalog)", () => {
  it('browses the featured stations', async (t) => {
    const app = await build(t);
    const res = await app.inject('/v1/stations');
    assert.equal(res.statusCode, 200);
    const { stations } = res.json();
    assert.deepEqual(
      stations.map((s) => s.id),
      ['Desi Hip Hop', 'Workout Karo'],
    );
    assert.equal(stations[0].language, 'hindi');
  });

  it('selects the language via a Cookie header, not the (upstream-ignored) query param', async (t) => {
    const up = fakeUpstream();
    const app = await build(t, { fetch: up.fetch });
    await app.inject('/v1/stations?language=tamil');
    const i = up.calls.lastIndexOf('content.getBrowseModules');
    assert.ok(i !== -1);
    assert.equal(up.headers[i]?.cookie, 'L=tamil; DL=tamil');
  });

  it('sends no language cookie when none is requested', async (t) => {
    const up = fakeUpstream();
    const app = await build(t, { fetch: up.fetch });
    await app.inject('/v1/stations');
    const i = up.calls.lastIndexOf('content.getBrowseModules');
    assert.ok(i !== -1);
    assert.equal(up.headers[i]?.cookie, undefined);
  });

  it('starts a station and returns its id', async (t) => {
    const app = await build(t);
    const res = await app.inject({ method: 'POST', url: '/v1/stations', payload: { name: 'Desi Hip Hop' } });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().stationId, 'S-fake-station-id');
  });

  it('requires a name to start a station', async (t) => {
    const app = await build(t);
    const res = await app.inject({ method: 'POST', url: '/v1/stations', payload: {} });
    assert.equal(res.statusCode, 400);
  });

  it('pulls the next batch of songs from a station', async (t) => {
    const app = await build(t);
    const res = await app.inject('/v1/stations/S-fake-station-id/songs?limit=5');
    assert.equal(res.statusCode, 200);
    const { tracks } = res.json();
    assert.equal(tracks[0].id, 'rjkrTnma');
    assert.equal(tracks[0].title, 'Kesariya');
  });
});

describe("podcasts (JioSaavn's own show catalog)", () => {
  it('browses the show catalog', async (t) => {
    const app = await build(t);
    const res = await app.inject('/v1/podcasts');
    assert.equal(res.statusCode, 200);
    const { shows } = res.json();
    assert.deepEqual(
      shows.map((s) => s.id),
      ['62', '175427'],
    );
    // The token, not the plain id, is what `GET /v1/podcasts/{token}` needs.
    assert.equal(shows[0].token, 'PjReFP-Sguk_');
  });

  it('gets one show with its seasons and episodes', async (t) => {
    const app = await build(t);
    const res = await app.inject('/v1/podcasts/PjReFP-Sguk_?season=3');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.show.title, 'Talking Music');
    assert.equal(body.seasons[0].seasonNumber, 3);
    assert.deepEqual(
      body.episodes.map((e) => e.id),
      ['3zKcXONr', '6nRIuRNp'],
    );
  });

  it('an episode id plays through the existing track-audio endpoint, unchanged', async (t) => {
    // JioSaavn's `song.getDetails` (which `/v1/tracks/{id}/audio` already calls) resolves episode ids
    // exactly like song ids — no new audio code needed for podcasts.
    const app = await build(t);
    const res = await app.inject('/v1/tracks/3zKcXONr/audio');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().trackId, '3zKcXONr');
  });

  it('an unreachable upstream is a 502, not a crash', async (t) => {
    const app = await build(t, {
      fetch: async () => {
        throw new Error('network down');
      },
    });
    assert.equal((await app.inject('/v1/podcasts/PjReFP-Sguk_')).statusCode, 502);
  });
});

describe('browseModules is cached raw, like launchData', () => {
  it('one upstream call serves both /v1/stations and /v1/podcasts', async (t) => {
    const up = fakeUpstream();
    const app = await build(t, { fetch: up.fetch });
    const calls = () => up.calls.filter((c) => c === 'content.getBrowseModules').length;

    await app.inject('/v1/stations');
    await new Promise((r) => setTimeout(r, 50)); // the cache write lands after the response
    const before = calls();
    await app.inject('/v1/podcasts');
    assert.equal(calls(), before);
  });
});
