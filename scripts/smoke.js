/**
 * Live smoke test against a running NAAD instance, JioSaavn and LRCLIB.
 *   BASE_URL=http://localhost:8080 NAAD_API_KEY=... npm run smoke
 * Exits non-zero if any check fails.
 */
const BASE = (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const headers = process.env.NAAD_API_KEY ? { authorization: `Bearer ${process.env.NAAD_API_KEY}` } : {};

async function get(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
    redirect: 'manual',
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body, res };
}

const results = [];
async function check(name, fn) {
  const t = performance.now();
  try {
    const info = await fn();
    results.push({ name, ok: true, info: `${info} (${Math.round(performance.now() - t)} ms)` });
  } catch (err) {
    results.push({ name, ok: false, info: err.message });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function firstTrack(q) {
  const { status, body } = await get(`/v1/search?types=track&limit=1&q=${encodeURIComponent(q)}`);
  assert(status === 200 && body.tracks?.[0], `search "${q}" returned ${status}`);
  return body.tracks[0];
}

async function playable(q) {
  const t = await firstTrack(q);
  const { status, body } = await get(`/v1/tracks/${t.id}/audio`);
  assert(status === 200, `audio ${status}: ${body.message ?? ''}`);
  // The CDN serves the file directly; fetch its first bytes.
  const r = await fetch(body.url, { headers: { range: 'bytes=0-15' } });
  assert(r.status === 206 || r.status === 200, `CDN responded ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert(bytes.length > 0, 'empty audio');
  return `${t.title} → ${body.codec} ${body.bitrateKbps} kbps`;
}

await check('health', async () => {
  const { status, body } = await get('/readyz');
  assert(status === 200, `readyz ${status}`);
  return `${body.status}; ${JSON.stringify(body.checks)}`;
});
await check('search top result', async () => {
  const { body } = await get('/v1/search?q=the%20weeknd%20blinding%20lights&limit=3');
  assert(body.topResult?.type === 'track', `top result was ${body.topResult?.type}`);
  return body.topResult.item.title;
});
await check('audio: Blinding Lights', () => playable('the weeknd blinding lights'));
await check('audio: Kesariya', () => playable('kesariya arijit singh'));
await check('home', async () => {
  const { status, body } = await get('/v1/home');
  assert(status === 200 && body.sections?.length >= 1, `home ${status}`);
  return body.sections.map((s) => `${s.id}:${s.items.length}`).join(', ');
});
await check('synced lyrics', async () => {
  const t = await firstTrack('the weeknd blinding lights');
  const { status, body } = await get(`/v1/tracks/${t.id}/lyrics`);
  assert(status === 200 && body.synced?.length > 10, `lyrics ${status}`);
  return `${body.synced.length} lines from ${body.source}`;
});
await check('radio station: browse, start, play', async () => {
  const { status: browseStatus, body: browseBody } = await get('/v1/stations');
  assert(browseStatus === 200 && browseBody.stations?.length > 0, `stations ${browseStatus}`);
  const station = browseBody.stations[0];
  const { status: createStatus, body: createBody } = await get('/v1/stations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: station.name, language: station.language }),
  });
  assert(createStatus === 201 && createBody.stationId, `create station ${createStatus}`);
  const { status: songsStatus, body: songsBody } = await get(
    `/v1/stations/${encodeURIComponent(createBody.stationId)}/songs?limit=5`,
  );
  assert(songsStatus === 200 && songsBody.tracks?.length > 0, `station songs ${songsStatus}`);
  return `${station.name}: ${songsBody.tracks.length} tracks`;
});
await check('podcast: browse, show, episode audio', async () => {
  const { status: browseStatus, body: browseBody } = await get('/v1/podcasts');
  assert(browseStatus === 200 && browseBody.shows?.length > 0, `podcasts ${browseStatus}`);
  const show = browseBody.shows[0];
  const { status: showStatus, body: showBody } = await get(`/v1/podcasts/${show.token}`);
  assert(showStatus === 200 && showBody.episodes?.length > 0, `show ${showStatus}`);
  const episode = showBody.episodes[0];
  const { status: audioStatus, body: audioBody } = await get(`/v1/tracks/${episode.id}/audio`);
  assert(audioStatus === 200, `episode audio ${audioStatus}: ${audioBody.message ?? ''}`);
  return `${show.title} → ${episode.title} (${audioBody.bitrateKbps} kbps)`;
});
await check('library round trip', async () => {
  const json = (method, body) => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await firstTrack('blinding lights');
  let playlistId;
  try {
    let r = await get('/v1/library/tracks', json('PUT', { trackIds: [t.id] }));
    assert(r.status === 200, `like ${r.status}: ${r.body.message ?? ''}`);
    r = await get(`/v1/library/tracks/contains?ids=${t.id}`);
    assert(JSON.stringify(r.body) === '[true]', `contains ${JSON.stringify(r.body)}`);
    r = await get('/v1/playlists', json('POST', { title: 'naad smoke', trackIds: [t.id] }));
    assert(r.status === 201, `create playlist ${r.status}: ${r.body.message ?? ''}`);
    playlistId = r.body.id;
    r = await get(`/v1/playlists/${playlistId}`);
    assert(r.body.tracks?.[0]?.id === t.id && r.body.origin === 'user', 'playlist did not read back');
    r = await get(
      '/v1/history',
      json('POST', {
        listens: [{ trackId: t.id, startedAt: new Date().toISOString(), msPlayed: 45_000 }],
      }),
    );
    assert(r.status === 200, `history ${r.status}: ${r.body.message ?? ''}`);
    r = await get('/v1/history?limit=1');
    assert(r.body.items?.[0]?.track?.id === t.id, 'history did not read back');
    r = await get('/readyz');
    return `${t.title}: like, playlist, history; ${JSON.stringify(r.body.checks)}`;
  } finally {
    if (playlistId) await get(`/v1/playlists/${playlistId}`, { method: 'DELETE' });
    await get('/v1/library/tracks', json('DELETE', { trackIds: [t.id] }));
  }
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '✔' : '✘'} ${r.name.padEnd(28)} ${r.info}`);
}
process.exit(failed ? 1 : 0);
