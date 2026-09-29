# NAAD

A small caching proxy for **JioSaavn** (music) and **LRCLIB** (lyrics). A browser can't call JioSaavn
directly (its API sends no CORS headers), so this service calls it on the frontend's behalf, cleans up the
responses, and caches them in Redis.

* **Two upstreams, nothing else:** JioSaavn's private web API and LRCLIB.
* **Redis is the only store, in two roles.** No database.
  * The **cache Redis** (`REDIS_URL`) holds only disposable data: cached upstream responses. Losing it loses
    nothing but speed.
  * The **library Redis** (`LIBRARY_REDIS_URL`) holds the only persistent state: one person's liked tracks,
    saved albums, followed artists, playlists and play history. It must not evict data
    (`maxmemory-policy noeviction`). Unset, it falls back to `REDIS_URL`, which is fine locally but not for
    production.
    * **Upstash:** keep **Eviction switched off** (console → your database → Eviction) for the database that holds the
      library. Upstash has a single algorithm, `optimistic-volatile`, which evicts keys that have a TTL first and then
      any other key; with eviction off, a full database rejects new writes and deletes nothing. `CONFIG GET` is
      blocked there and `INFO memory` shows that algorithm name whether eviction is on or off, so `naad` cannot check
      the switch for you: look at the console.
* **Audio is never proxied.** The API hands out the static CDN URL of the audio file; the browser plays it
  directly.

## API

Everything is `GET` unless noted.

| Endpoint | Returns |
| --- | --- |
| `/v1/home` | The JioSaavn homepage as `{ sections }` (same modules, order and titles) |
| `/v1/search?q=&types=track,album,artist,playlist&limit=&offset=` | Results per type plus a `topResult`. Add `show` to `types` (opt-in, never the `topResult`) to search JioSaavn's podcasts too |
| `/v1/tracks/{id}` | A track |
| `/v1/albums/{id}` · `/v1/artists/{id}` · `/v1/playlists/{id}?limit=` | An album / artist page / playlist, with tracks |
| `/v1/tracks/{id}/audio?quality=max\|320\|160\|96` | `{ url, bitrateKbps, codec, mimeType, durationMs }`: a static CDN URL, usable as `<audio src>` |
| `POST /v1/player/prefetch` `{ trackIds }` | Warms the audio lookups of upcoming queue items |
| `/v1/tracks/{id}/lyrics` | Lyrics from LRCLIB, time-synced when available |
| `/v1/stations?language=` | JioSaavn's curated radio stations (mood/language/artist presets): `{ stations }` |
| `POST /v1/stations` `{ name, language? }` | Starts a station by the `name` a listing gave you: `201 { stationId }` |
| `/v1/stations/{id}/songs?limit=` | The next batch of tracks from a station |
| `/v1/podcasts?language=` | JioSaavn's podcast/show catalog: `{ shows }` (each with a `token`, not its plain `id`) |
| `/v1/podcasts/{token}?season=` | One show's details, seasons and episodes, by the `token` a listing gave you (episode audio is `/v1/tracks/{id}/audio`, unchanged) |
| `/v1/art?src=&size=` | Artwork proxy (JioSaavn image hosts only) |
| `/healthz` · `/readyz` | Liveness / readiness (Redis) |

### Library

One person's library, identified by the API key (there are no accounts). Lists are `{ items, next }` with
`?limit=&cursor=` (limit up to 500, default 500; `cursor` is opaque). Mutations answer `200` with an empty
body, except the two `POST`s that create something (`201`). Items are stored as snapshots, so lists render
without upstream calls.

| Endpoint | Does |
| --- | --- |
| `GET /v1/library/tracks` | Liked tracks, newest first: `{ items: [{ likedAt, track }] }` |
| `PUT` / `DELETE /v1/library/tracks` `{ trackIds }` | Like / unlike (up to 100 ids, idempotent) |
| `GET /v1/library/tracks/contains?ids=a,b` | `boolean[]`, aligned to `ids` (up to 100) |
| `GET /v1/library/albums` · `PUT`/`DELETE /v1/library/albums/{id}` | Saved albums `[{ savedAt, album }]`; save / remove |
| `GET /v1/library/artists` · `PUT`/`DELETE /v1/library/artists/{id}` | Followed artists `[{ followedAt, artist }]`; follow / unfollow |
| `GET /v1/library/playlists` | Your playlists (`origin: 'user'`) then saved JioSaavn ones (`origin: 'external'`) |
| `PUT` / `DELETE /v1/library/playlists/{id}` | Save / remove a JioSaavn playlist |
| `POST /v1/playlists` `{ title, description?, trackIds? }` | Create a playlist: `201 { id }` (ids look like `usr_<uuid>`) |
| `PATCH` / `DELETE /v1/playlists/{id}` | Rename / delete one of your playlists (`404` for any other id) |
| `POST /v1/playlists/{id}/items` `{ trackIds, position? }` | Add tracks at `end` (default) or `start`: `201 { itemIds }` |
| `DELETE /v1/playlists/{id}/items` `{ itemIds }` | Remove items |
| `POST /v1/playlists/{id}/items/{itemId}/move` `{ afterItemId }` | Reorder; `null` moves to the front, `404` if either item is gone |
| `GET /v1/history` · `POST /v1/history` `{ listens }` | Play history (newest 5000): `[{ playedAt, msPlayed, track }]`; report plays (up to 100) |
| `GET /v1/library/export` | Everything above as one JSON document, for backup |

`GET /v1/playlists/{id}` serves your own playlists (with `entries: [{ itemId, addedAt }]` parallel to `tracks`) and
JioSaavn ones (with `origin` and `inLibrary`). A playlist holds at most 1000 tracks.

Ids are JioSaavn's own ids. A track's, album's or episode's `artists[]` entries can have `id: null` when
JioSaavn gives no real artist id for that credit (rare); that credit's `name` is still shown, but it can't
be looked up with `GET /v1/artists/{id}` — a client should hide any "go to artist" action when `id` is
`null`. Errors are the Fastify default: `{ statusCode, error, message }`.

## How it works

```text
app.js                      autoloads plugins/ then routes/ (the fastify-cli layout, plain ES modules)
plugins/                    cache and library Redis, jiosaavn (the business logic), library, cors, auth, rate-limit, sensible
routes/                     folder = URL prefix: v1/home, v1/search, v1/tracks, ... plus /healthz /readyz
lib/
  jiosaavn/
    client.js               the JioSaavn API calls (raw responses cached in Redis)
    map.js                  raw response -> the API's shapes
    catalog.js              search, tracks, albums, artists, playlists
    discovery.js, home.js   the home feed
    stations.js             JioSaavn's own curated radio stations (browse, start, next songs)
    podcasts.js             JioSaavn's own podcast/show catalog (browse, one show's seasons and episodes)
    audio.js                song id -> audio URL (decrypts JioSaavn's encrypted_media_url); des.js is the DES cipher
  library/                  the persistent library: collections.js (likes, saved albums, followed artists),
                            playlists.js, history.js, snapshots.js; util.js has the shared Redis helpers
  lyrics.js                 LRCLIB lookups
  cache.js, upstream.js     Redis JSON cache; fetch helper with timeout and one retry
  text.js                   text cleaning and search ranking
  types.d.ts                Fastify decorator types (erased, never loaded)
```

* **Caching.** Raw JioSaavn responses are stored gzipped in Redis and mapped on the way out. Search results,
  albums, artists and playlists are cached for minutes to hours; the audio lookup for a song is cached for 24 h;
  lyrics are cached for 30 days (a song without lyrics for 7 days).
* **Audio.** JioSaavn gives each song an encrypted URL. It is decrypted (single DES) into the 96 kbps file's
  URL, and the 160 / 320 kbps files share the same path with a different suffix.
* **The API is a mirror, not a merge.** Search results are re-ranked so the plain song beats remixes and
  namesakes; everything else is JioSaavn's data, cleaned (HTML entities decoded, images at three sizes).

## Running locally

Requirements: Node ≥ 22.9 and Redis (or Valkey).

```bash
npm ci
cp .env.example .env            # set REDIS_URL
npm run dev                     # http://localhost:8080 (fastify start with --watch)
```

The sources are plain JavaScript (ES modules), so there is no build step. `npm run typecheck` runs `tsc` with
`checkJs` against the JSDoc and `lib/types.d.ts`; `jsconfig.json` turns off `noImplicitAny`,
`noUncheckedIndexedAccess` and `useUnknownInCatchVariables`, so JSDoc is only needed where it helps.
`npm start` runs `fastify start` on 0.0.0.0 (PORT, default 3000; set PORT=8080) behind a TLS reverse proxy.

## Configuration

See `.env.example`. Notable settings: `REDIS_URL` (cache), `LIBRARY_REDIS_URL` (library; see above),
`CORS_ORIGINS` (your frontend's origin),
`NAAD_API_KEY` (required when `NODE_ENV=production`) and `RATE_LIMIT_PER_MINUTE`.

## Testing

```bash
npm test                        # unit tests plus the whole API against canned upstream responses (needs Redis: TEST_REDIS_URL, default db 15, and TEST_LIBRARY_REDIS_URL, default db 14)
npm run smoke                   # live checks against a running instance, JioSaavn and LRCLIB
npm run lint && npm run typecheck
```
