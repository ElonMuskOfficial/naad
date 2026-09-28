# naad Android app: design spec

Date: 2026-09-29 · Status: approved in brainstorming, awaiting written-spec review

## 1. Purpose and constraints

A personal Android music app for one person (the owner). It is installed on the owner's own phone(s) as a
signed APK and never published to the Play Store. It streams music from the owner's deployed naad server
(HTTPS).

Rules the owner set, which every later decision must follow:

- Build only what the naad backend actually provides. No feature that needs data or an endpoint we do
  not have.
- No workarounds, no hacks, no over-engineering. If a feature needs a workaround, drop it or find a
  clean approach.
- No algorithms of our own (no recommendations, autoplay, "similar songs", or re-ranking).
- Use YouTube Music's current Android layout (Sept 2026, from the owner's screenshots in
  `ytmusic-reference-screenshots/`) as the visual and interaction reference, but only for features our data can
  fill.
- Official Android stack.

Why "personal only": the backend has one library tied to one shared API key (no accounts), and it relies
on JioSaavn's private API. Both rule out a public release. Changing that means backend work, which is out
of scope.

## 2. What the backend provides (verified in the code, not the README)

All `/v1` routes need `Authorization: Bearer <NAAD_API_KEY>`. Errors are `{ statusCode, error, message }`.

| Feature | Endpoint | Notes that affect the app |
| --- | --- | --- |
| Home | `GET /v1/home` returns `{ sections: [{ id, title, subtitle?, items: [{ kind, item }] }] }` | `kind` is `track`, `album`, `playlist` or `artist`, and one section may mix kinds. There is no language parameter and no "see more" endpoint. |
| Search | `GET /v1/search?q&types&limit&offset` | Default types are track, album, artist, playlist; `show` is opt-in. `limit` ≤ 50, `offset` ≤ 200. Each type has its own list plus a `topResult` (offset 0 only). `nextOffset` is null when there are no more results. There is no combined ranking across types. |
| Track | `GET /v1/tracks/{id}` | Includes `url` (the JioSaavn web link, used for Share). |
| Audio | `GET /v1/tracks/{id}/audio?quality=max\|320\|160\|96` | Returns `{ url, bitrateKbps, codec: aac, mimeType: audio/mp4, durationMs }`. The URL is a static CDN file. `refresh=true` exists but is not used in v1. |
| Prefetch | `POST /v1/player/prefetch { trackIds ≤ 10 }` | Warms the server's audio lookups. |
| Lyrics | `GET /v1/tracks/{id}/lyrics` | Time-synced lines only (`synced: [{ timeMs, text }]`). `plain` is always null. Returns 404 when there are none. |
| Album | `GET /v1/albums/{id}` | Album fields plus `tracks`. There is no description and no share link. |
| Artist | `GET /v1/artists/{id}` | Returns `id, name, images, topTracks (≤20), albums, singles, related`. There is no bio, follower count or share link. |
| Playlist | `GET /v1/playlists/{id}?limit` | JioSaavn playlists return at most 200 tracks (no paging), plus `origin: external` and `inLibrary`. User playlists (`usr_…`) return `tracks` plus a parallel `entries: [{ itemId, addedAt }]`. |
| Stations | `GET /v1/stations`, `POST /v1/stations { name }`, `GET /v1/stations/{id}/songs?limit` | `name` must be the listing's `id`, not its display `name`. Each songs call returns the next batch. |
| Podcasts | `GET /v1/podcasts`, `GET /v1/podcasts/{token}?season` | Shows are opened by `token`, not `id`. The response is `{ show, seasons, episodes }`. Episode audio uses the normal audio endpoint. Shows and episodes have `url` (used for Share). |
| Liked songs | `GET/PUT/DELETE /v1/library/tracks`, `GET /v1/library/tracks/contains?ids` | Up to 100 ids per call. The list returns `{ items: [{ likedAt, track }], next }`. |
| Saved albums / followed artists | `GET /v1/library/albums`, `PUT/DELETE /v1/library/albums/{id}` (same shape for `artists`) | There is no `contains` endpoint (see 5.5). |
| Playlists in library | `GET /v1/library/playlists`, `PUT/DELETE /v1/library/playlists/{id}` | Own playlists (`origin: user`) come first, then saved JioSaavn playlists. |
| Own playlists | `POST /v1/playlists`, `PATCH/DELETE /v1/playlists/{id}`, `POST/DELETE /v1/playlists/{id}/items`, `POST …/items/{itemId}/move { afterItemId }` | Edits use `itemId`, not `trackId` (a playlist can hold the same song twice). At most 1000 tracks per playlist and 100 ids per request. |
| History | `GET /v1/history?limit&cursor`, `POST /v1/history { listens }` | A listen is `{ trackId, startedAt, msPlayed, completed?, context? }`. `context.id` must be ≤ 64 characters, or the whole request is rejected (see 6.3). |

**Paging:** every library list (`/library/tracks`, `/albums`, `/artists`) and `/history` returns at most
one page (≤ 500 items) plus a `next` cursor. The app follows `next` for as long as it is not null. It never
assumes one page is the whole list.

**CDN access, checked 2026-09-29:** a JioSaavn audio URL (from an old test fixture) and an image URL both
answer normally to ExoPlayer, OkHttp and empty User-Agents. Audio returns `206` for range requests, so
seeking works. The fixture's audio URL still works, so URLs do not expire quickly.

Unused on purpose: `/v1/art` (it exists only because browsers block cross-site images; Android loads
CDN images directly), `DELETE /v1/cache` (a server admin action), `GET /v1/library/export` (backups
can be taken from the server directly), `/healthz` and `/readyz`.

## 3. Out of scope for v1

| Feature | Why |
| --- | --- |
| Autoplay, similar songs, song radio, artist radio, "Related", mixes | No endpoint; the owner rules out our own algorithms. |
| Mood chips, speed dial, personalised shelves | No data. |
| Search suggestions | No endpoint. |
| Recent searches | Owner's choice. |
| Play counts, subscriber counts, artist bio, album description, comments | Not in the API. |
| Dislike (👎) | Not in the API. |
| Video, Samples, Cast, Android Auto | Not in the API or not wanted for v1. |
| Downloads and offline playback | Owner's choice (Media3 DownloadManager could add it later). |
| Language picker | No endpoint lists valid languages. A hard-coded list would be a workaround. |
| Library sort, grid/list switch, library search, "Recent activity" mixed view | Not needed. Own playlists carry no date, so a mixed sort would have to guess. |
| Save queue as playlist, sleep timer, crossfade, equalizer, queue restore after reboot | Later. |
| Share for albums, artists and playlists | These have no link in the API. |
| Accounts, login, settings for server URL or key | Personal build. The URL and key are set at build time. |

## 4. Screens and interaction (Section 1)

The layout follows the owner's YouTube Music screenshots, filtered to our data.

### 4.1 App frame

- Bottom navigation has three tabs: **Home · Search · Library**. Each tab keeps its own back stack.
- The mini player sits above the tabs. It shows artwork, title, artists and play/pause, and it is hidden
  when nothing is loaded. There is no Cast button.
- The top bar shows ⚙ Settings on Home and Library. There is no notifications bell.

### 4.2 Home

- JioSaavn's sections are shown in the server's order, with the server's titles and subtitles.
- A section that contains only songs uses the "Quick picks" layout: 4 rows per column, swiped
  sideways, with a **Play all** button. Rows show title and artists.
- A section of albums or playlists uses large square cards. The subtitle is `Album • Artist`,
  `Single • Artist` (from `albumType`) or `Playlist`.
- A section of artists uses round photos.
- A mixed section uses cards whose subtitle names the kind (`Song • …`, `Album • …`), in server order.
- Tapping a song plays it and opens the full player. Tapping anything else opens its page.
- There are no "see all" arrows, because a section already contains everything the server has.

### 4.3 Search tab

- Before typing, the screen shows a search box and two tiles: **Radio stations** and **Podcasts**. Each
  tile opens a page.
- Pressing the keyboard's search key runs the search. ✕ clears it.
- The results show a **Top result** card (a song gets **Play** and **Save to playlist**; an artist or
  album opens its page on tap), then groups by type:
  Songs, Albums, Artists, Playlists and Podcasts. They are grouped, not interleaved, because the API has
  no cross-type ranking.
- The chips are Songs · Albums · Artists · Playlists · Podcasts. Selecting one (marked ✕) shows only
  that type as a long list with "Load more" (driven by `nextOffset`, and stopping at the API's offset
  limit).
- Exact `types` values:
  - no chip: `types=track,album,artist,playlist,show` (`show` must be listed explicitly because it is
    opt-in)
  - chips: `track`, `album`, `artist`, `playlist`, `show`
- The **Radio stations page** is a grid of `GET /v1/stations`. Tapping a station starts it (see 6.4).
- The **Podcasts page** is a grid of `GET /v1/podcasts`. Tapping a show opens it.

### 4.4 Library tab

- The top bar is: Library, then 🕘 History, then ⚙.
- The chips are **Playlists · Albums · Artists**, and Playlists is selected by default.
- Under Playlists, **👍 Liked music** is pinned first (subtitle "Auto playlist"). Your own playlists come
  next (`Playlist • N tracks`), then saved JioSaavn playlists.
- A floating **＋ New** button creates a playlist (asks for a name).
- Lists appear in server order (newest first).

### 4.5 History

Played songs, newest first, grouped under Today / Yesterday / date headings. More rows load via
`cursor`.

### 4.6 Album page

- Content: artwork, title, `Artist • year`, and three actions: **🔖 Save**, **▶ Play** and **⋮**.
- Tracks are numbered. The playing track shows ▮▮ instead of its number.
- The footer reads `N songs • M minutes` (the sum of `durationMs`).
- ⋮ opens: Shuffle play · Play next · Add to queue · Save to playlist · Go to artist.

### 4.7 Artist page

- Content: a large photo with the name, **＋ Follow / Following**, and ▶ (plays the top songs).
- **Top songs** shows 4 rows, **Play all**, and › (opens all 20).
- Then **Albums** (subtitle is the year), **Singles and EPs** (`Single • year`) and **Fans might also
  like** (round photos from `related`).

### 4.8 Playlist page

- It uses the same layout as the Album page.
- **JioSaavn playlist:** 🔖 Save (from `inLibrary`), showing up to 200 songs.
- **Own playlist:**
  - ⋮ offers Rename and Delete.
  - Drag ≡ to reorder.
  - A song's ⋮ adds **Remove from playlist**.
- **Liked music:** opens here, with Play and Shuffle.

### 4.9 Podcast show page

- Content: artwork, title, host, description and a **Season ▾** picker (it reloads with `?season=`).
- Episodes show number, title, date and length, with ▶ to play.
- Share is available (from `url`).

### 4.10 Full player (Now Playing)

- **Opening:** starting any playback opens the full player immediately. ⌄, system Back, or swiping down
  collapses it to the mini player.
- **Top part:** ⌄ and ⋮; the artwork; title and artists; **👍** and **❝ Lyrics** buttons; a seek bar with
  times; and shuffle · previous · play/pause · next · repeat.
- **Bottom handle:** reads "Playing from `<source>`". Tapping it or dragging it up opens the queue sheet.
- **Queue sheet:**
  - "Playing from `<source>`" at the top.
  - The current song is highlighted.
  - Each row shows artwork, title, artists and duration.
  - Drag ≡ to reorder, swipe a row sideways to remove it, tap a row to jump to it.
- **Lyrics sheet:**
  - A small player strip at the top, and ✕ to close.
  - The current line is highlighted, other lines are dimmed, and the view auto-scrolls.
  - When there are no lyrics (a 404), it reads "No synced lyrics for this song".

### 4.11 Song menu (⋮ or long-press)

- The header shows title, `artists • duration`, 👍 and ✕.
- Three big buttons: **Play next · Save to playlist · Share**.
- Then a list: Add to queue · Go to album · Go to artist.
- Context adds **Remove from playlist** in own playlists.
- **Go to album** is hidden when `track.album` is null (always the case for podcast episodes).
- **Go to artist** opens the artist directly when there is one artist. With several, it opens a
  small sheet listing them, as YouTube Music does.
- **Artists without a real id:** the backend's `credits()` (`lib/jiosaavn/map.js`) falls back to the
  artist's *name* as `id` when JioSaavn gives no id, and `/v1/artists/{name}` returns 404. See the open
  decision in 8.
- Save to playlist opens a sheet: ＋ New playlist, then your playlists.

### 4.12 Settings

- The ⚙ icon opens **Settings** directly. There is no account menu and no Activity (notifications)
  feed, because there are no accounts and no notification data.
- Settings is a simple list page, like YouTube Music's (`settings-01`). It has one row: **Audio
  quality**, whose subtitle shows the current value.
- Tapping the row opens a radio dialog, like `settings-05`:

  | Option | `quality` sent |
  | --- | --- |
  | Low | `96` |
  | Normal | `160` |
  | High | `max` (320 kbps when the song has it, otherwise 160) |

  The default is **High**. A change takes effect from the next song.
- **Dropped** from YouTube Music's settings pages:
  - Equaliser
  - Double-tap to seek (a video feature)
  - Consistent volume (no loudness data)
  - Dynamic queue (an algorithm)
  - Allow external devices to start playback (needs queue restore, which is out of scope)
  - Every download, account, family, privacy and premium page

### 4.13 What "Play" puts in the queue

There is no autoplay, so the queue is exactly what you started. The single rule: **the songs of the list
the tapped row is in, in the order shown, starting at the tapped song.** Per source:

| Source | Queue |
| --- | --- |
| Album, playlist, Liked music | All its songs (every page of Liked music). ▶ starts at the first song, and Shuffle turns on shuffle. |
| Artist page | All 20 top songs (even though the page shows 4). |
| Home section | The song items of that section, in order. Albums, playlists and artists in a mixed section are skipped. |
| Search results | The song results currently loaded in that list. The Top result card plays only its one song. |
| History | The loaded history rows. |
| Podcast show | The episodes of the selected season, in order. |
| Radio station | Batches from the station (see 6.4). |
| ⋮ Play next / Add to queue | That one song. On the album and playlist ⋮, all of its songs. |

### 4.14 Gestures

| Where | Gesture | Action |
| --- | --- | --- |
| Mini player | tap or swipe up | Open full player |
| Mini player | swipe left / right | Next / previous song |
| Mini player | swipe down | Nothing (YouTube Music removed swipe-to-dismiss) |
| Full player | ⌄, Back, or swipe down | Collapse to mini player |
| Full player | swipe left / right on the artwork | Next / previous song |
| Full player | drag the seek bar | Seek |
| Full player | tap or drag up the bottom handle | Open queue |
| Queue | drag ≡ | Reorder |
| Queue | swipe a row sideways | Remove |
| Queue | tap a row | Jump to that song |
| Queue | swipe down or Back | Close |
| Lyrics | ✕, Back, or swipe down | Close |
| Song rows | tap | Play and open the full player |
| Song rows | long-press | Song menu ⚠ (verify on device) |
| Carousels | swipe sideways | Scroll |
| Library, History | pull down | Refresh |
| Navigation | system Back | Closes sheet or player → previous page in the tab → Home tab → exits app |
| Navigation | tap the current tab again | Scroll to top / return to the tab's first page ⚠ (verify on device) |

Sources: the owner's description and screenshots, and coverage of YouTube Music's rollouts (Android
Police, 9to5Google, XDA). YouTube publishes no official gesture reference.

## 5. Architecture (Section 2)

### 5.1 Stack

- **Language and UI:** Kotlin, Jetpack Compose, Material 3.
- **Navigation:** Navigation 3, single Activity, with multiple back stacks for the tabs.
- **App structure:** ViewModel + StateFlow, and Hilt for dependency injection.
- **Networking:** Retrofit + OkHttp + kotlinx.serialization.
- **Images:** Coil (loads CDN image URLs directly; 150px for rows, 500px for large artwork).
- **Playback:** Media3 (ExoPlayer, MediaSessionService, MediaController).
- **Settings storage:** DataStore (streaming quality only).
- **Reordering:** the Reorderable library (Calvin-LL) for drag-to-reorder, because Compose has no
  official component for it.
- **Everything else is official Compose or Material 3:**
  - `anchoredDraggable` (player drag)
  - `HorizontalPager` (swipe to change song)
  - `SwipeToDismissBox` (swipe to remove)
  - `PredictiveBackHandler`
  - `PullToRefreshBox`
  - `combinedClickable` (long-press)

### 5.2 Project

- A separate repository, created in Android Studio. This spec lives in the naad repo.
- One `app` module, packaged by feature:

```text
core/network/   NaadApi (Retrofit), JSON models, auth interceptor
core/ui/        shared components: song row, cards, mini player, song menu, state views
home/ search/ library/ history/ album/ artist/ playlist/ podcast/ radio/ player/ settings/
```

- The server URL and API key are read from a git-ignored `local.properties` into `BuildConfig`. One
  OkHttp interceptor adds `Authorization: Bearer <key>`.
- Minimum SDK is Android 8.0 (API 26). Target and compile SDK are the newest stable release (the
  exact numbers are confirmed in the implementation plan).

### 5.3 Layers

```text
UI (Compose screens + one ViewModel each)
  → Repositories (one per area: catalog, library, playlists, history, stations, podcasts)
    → NaadApi (one suspend function per endpoint)
```

- The JSON models mirror the API exactly. Nothing is renamed or reshaped.
- A Home item `{ kind, item }` decodes by `kind` into a sealed type.
- There is no local database or cache. The server is the single source of truth. Screens load when
  opened, and they reload after a change (like, save, follow, playlist edit).

### 5.4 Screen states

Every screen's ViewModel exposes one state:

| State | Shows |
| --- | --- |
| Loading | Skeleton placeholders shaped like the content |
| Content | The page, including the per-item states below |
| Empty | A message, e.g. "Songs you 👍 will appear here", "No results for 'x'" |
| Error: offline | "You're offline" and Retry |
| Error: server | "Something went wrong" and Retry |
| Error: not found (404) | "This isn't available" and Back (no Retry, since retrying cannot help) |
| Error: API key (401) | "The API key was rejected. Check local.properties." (no Retry) |

Refreshing keeps the current content visible until new data arrives.

Per-item state inside Content:

- the mini player is shown or hidden
- Search shows tiles or results, grouped or as a single type
- the playing-song indicator
- own vs JioSaavn playlist controls
- 🔖 saved, Follow/Following, 👍 liked
- lyrics or none
- a radio or normal queue
- play/pause/buffering
- the selected season

### 5.5 Liked, saved and followed state

- **👍 on a song:** `GET /library/tracks/contains?ids=<id>` when the player shows a song or the song
  menu opens. Song lists do not show likes, which matches YouTube Music.
- **JioSaavn playlist saved:** the `inLibrary` field of the playlist response.
- **Album saved / artist followed:** the API has no `contains` for these. Opening the page also loads
  `GET /v1/library/albums` (or `/artists`) and checks for the id, following `next` pages until it is
  found or the list ends. The owner chose this over adding backend endpoints.

### 5.6 Icons

- **Set:** Google's **Material Symbols**, **Rounded** style, used throughout. Official Android guidance
  recommends Material Symbols over the legacy `material-icons` / `material-icons-extended` artifacts
  (no longer maintained, older look, slower builds), so those artifacts are **not** used.
- **How icons are added:**
  1. Download each icon's Android XML from fonts.google.com/icons.
  2. Put it in `res/drawable/`.
  3. Draw it with `Icon(painterResource(R.drawable.<name>), contentDescription = …)`.
- **Download settings** (fixed at download time, because Android vector files are not variable):
  - **Rounded**, **weight 400**, **grade 0**, **optical size 24**, **fill 0**. These are Material
    Symbols' defaults, per the Material Design 3 icon guidance (m3.material.io/styles/icons).
  - Every icon uses these exact values so thickness and detail match across the app.
- **Toggles** (👍 liked, 🔖 saved, the selected bottom tab) swap between two downloads of the same icon:
  fill 0 (outline) and **fill 1** (filled), named e.g. `thumb_up` and `thumb_up_filled`.
- **Icon list** (about 35):

  | Area | Icons |
  | --- | --- |
  | Navigation | `home`, `search`, `library_music`, `history`, `settings`, `arrow_back`, `expand_more`, `more_vert`, `close`, `chevron_right` |
  | Playback | `play_arrow`, `pause`, `skip_next`, `skip_previous`, `shuffle`, `repeat`, `repeat_one` |
  | Library (outline + filled) | `thumb_up`, `bookmark` |
  | Library | `add`, `person_add`, `check` |
  | Queue | `playlist_add`, `playlist_play`, `queue_music`, `drag_handle`, `delete` |
  | Other | `share`, `lyrics`, `album`, `person`, `radio`, `podcasts`, `wifi_off`, `error` |

- **Launcher icon:** the owner's own logo, generated into all sizes with Android Studio's Image Asset
  tool.

## 6. Player (Section 3)

### 6.1 Service

- `PlaybackService` extends Media3 `MediaSessionService` and owns the ExoPlayer and MediaSession.
- The manifest declares `foregroundServiceType="mediaPlayback"` and the `FOREGROUND_SERVICE` and
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permissions.
- The UI controls playback only through a `MediaController`.
- ExoPlayer is configured to:
  - handle audio focus (`setAudioAttributes(..., handleAudioFocus = true)`)
  - pause when headphones are unplugged (`setHandleAudioBecomingNoisy(true)`)
  - keep the network awake with the screen off (`setWakeMode(C.WAKE_MODE_NETWORK)`)
- The notification, lock-screen controls and Bluetooth/headset buttons come from the MediaSession.

### 6.2 Audio URLs, resolved when a song loads

- A queue item (`MediaItem`) carries the track id and display metadata: title, artists and 500px
  artwork.
- A `ResolvingDataSource` calls `GET /v1/tracks/{id}/audio?quality=<setting>` when the item loads, and
  plays the returned URL.
- When a queue is set, the app calls `POST /v1/player/prefetch` with the next ≤10 ids.

### 6.3 Queue

- Play replaces the queue, starts at the tapped song, and opens the full player.
- Play next, Add to queue, move, remove, shuffle and repeat are all Media3's own Player operations.
- The queue remembers its source (`{ type, id, title }`, e.g. album, playlist, station, search, home).
  The source is shown as "Playing from …" and sent as the listen `context`.
- The listen `context` is sent as follows:
  - For album, playlist, artist and show sources: `{ type, id }` (these ids fit the backend's 64-char
    limit).
  - For station, search, home, history and liked: `{ type }` only, because a station id or search text
    can exceed the limit and would make the backend reject the listen.
  - `title` is for display only and is never sent.
- Items added through the `MediaController` carry only `mediaId` and metadata. The session builds each
  item's playable (resolvable) URI in `MediaSession.Callback.onAddMediaItems`, because Media3 does not
  trust a controller-supplied URI.

### 6.4 Radio

- Starting a station calls `POST /v1/stations { name: station.id }` to get a `stationId`, then
  `GET /v1/stations/{stationId}/songs?limit=20`, then plays.
- On every song change, if fewer than 3 songs remain after the current one, the app fetches the next 20
  and appends them.
- Playing anything else ends the radio.

### 6.5 Play history

- The service measures the time each song actually plays (paused time is excluded).
- When the song changes or playback stops, and the song played **≥ 30 s or completed**, the app sends
  `POST /v1/history` with `{ trackId, startedAt, msPlayed, completed, context }`.
- A failed report is dropped, because there is no local storage.

### 6.6 Playback errors

- Audio not available (404): show "Can't play this song" and skip to the next.
- Network lost: pause and show a message. ▶ retries (`prepare()`).
- 401: show the API-key message.
- There are no automatic retries and no `refresh=true` in v1. Add them only if testing shows stale
  URLs.

## 7. Testing and definition of done (Section 4)

### 7.1 Automated tests (JVM, no device)

1. **Parsing tests:** one real response from each endpoint is saved once from the owner's server as a
   test resource, and each is decoded into the models.
2. **ViewModel tests:** fake repositories check the Loading → Content / Empty / offline / server / 401
   states.
3. **Pure-function tests for the two rules we own:**
   - "report a listen if ≥ 30 s or completed"
   - "refill radio when fewer than 3 songs remain"

No UI or screenshot tests in v1.

### 7.2 Manual device checklist

- **Playback:** plays with the screen off; notification and lock-screen controls work; Bluetooth or
  headset buttons work; unplugging headphones pauses; a phone call pauses, then resumes.
- **Gestures:** every gesture in 4.14, including the ⚠ ones.
- **Page states:** every screen with Wi-Fi off, and with a wrong API key.
- **Features:**
  - radio plays past its first 20 songs
  - History shows songs after 30 s
  - playlist reorder, rename and delete survive an app restart
  - Liked, saved and followed states are correct after toggling

### 7.3 Done means

- Every screen in section 4 exists with all its states.
- Every gesture works.
- The automated tests pass.
- The manual checklist passes on the owner's phone.
- A signed release APK (the owner's own keystore) installs and runs.

### 7.4 Rough build order

1. Project setup and API client
2. Home, then the Album, Artist and Playlist pages
3. Player (service, mini and full player, queue)
4. Search
5. Library, likes and History
6. Own playlists (create, edit, reorder)
7. Radio and Podcasts
8. Lyrics
9. Final pass on states and gestures

## 8. To verify during implementation planning

- The exact current stable versions of the Android SDK, Compose BOM, Media3, Navigation 3, Hilt,
  Retrofit, Coil and Reorderable.
- That Media3's playback notification needs no `POST_NOTIFICATIONS` runtime prompt on Android 13+
  (media-session notifications are believed to be exempt).
- The two ⚠ gestures in 4.14, on the owner's phone.

**Open decision (owner):** artists whose `id` is really their name (see 4.11). Options:

- **(a) Small backend fix.** `credits()` returns no id (null) for such artists, and the app hides "Go to
  artist" for them.
- **(b) Accept it.** The app offers "Go to artist", and the Artist page shows the not-found state.

## Appendix A: reference screenshots

The owner's YouTube Music screenshots (Android, Sept 2026) are in `ytmusic-reference-screenshots/`. They are named
`<area>-<nn>-<what it shows>.jpeg`. "Used for" names what we copy; everything else in a screenshot is
out of scope (section 3).

| Spec section | Screenshots | Used for |
| --- | --- | --- |
| 4.1 App frame | any `home-*`, `library-*` | Bottom tabs and mini player (without Cast) |
| 4.2 Home | `home-01`, `home-02`, `home-03`, `home-04` | Song-only section: 4 rows per column, swipe sideways, Play all |
| 4.2 Home | `home-08`, `home-09` | Card carousels and their `Album • Artist` subtitles; artist shelf |
| 4.2 Home | `home-05` to `home-07`, `home-10` to `home-12` | Reference only: mood chips, speed dial, podcast chip, featured card (all dropped) |
| 4.3 Search | `search-01`, `search-02` | Empty screen with tiles (ours: Radio stations and Podcasts; no recents) |
| 4.3 Search | `search-05`, `search-06`, `search-07` | Top result card, then results (ours are grouped by type) |
| 4.3 Search | `search-08` to `search-12` | One chip selected (✕), single-type list |
| 4.3 Search | `search-03`, `search-04` | Reference only: suggestions (dropped) |
| 4.3 Radio / Podcasts pages | `browse-06`, `browse-07` | Page with a back arrow and a title, listing items |
| 4.3 Radio / Podcasts pages | `browse-01` to `browse-05` | Reference only: New releases and Charts (no such endpoints) |
| 4.4 Library | `library-02`, `library-03` | Playlists chip, pinned "Liked music" auto playlist, ＋ New button |
| 4.4 Library | `library-01`, `library-04` | Reference only: Recent activity mix, Podcasts chip (dropped) |
| 4.6 Album | `album-01`, `album-02`, `album-03` | Header, action row, numbered tracks, ▮▮ now playing, `N songs • M minutes` footer |
| 4.6 Album | `album-04` | Album ⋮ menu (minus Start mix, Share, Pin) |
| 4.7 Artist | `artist-01`, `artist-02`, `artist-03`, `artist-05` | Header, Top songs, Albums, Singles and EPs, Fans might also like |
| 4.7 Artist | `artist-04` | Reference only: Featured on, Playlists by (no data) |
| 4.10 Full player | `player-01`, `player-02` | Player layout; "Playing from" handle |
| 4.10 Queue | `player-03` | Queue sheet (minus Save and Auto-play) |
| 4.10 Lyrics | `lyrics-01` to `lyrics-04` | Lyrics sheet: highlighted current line (minus Share and Translate) |
| 4.10 Related | `player-04` | Reference only: Related (no endpoint) |
| 4.11 Song menu | `player-05` | Header with 👍, three big buttons, list (minus Start mix, Download, Credits) |
| 4.12 Settings | `settings-01`, `settings-05` | List page; Audio quality radio dialog (Low / Normal / High) |
| 4.12 Settings | `settings-02` to `settings-04`, `account-01`, `account-02` | Reference only: General, Playback, Downloads pages, Account menu, Activity feed (dropped) |
