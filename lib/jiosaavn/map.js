import { cleanText } from '../text.js';

/** JioSaavn serves the same artwork at 50/150/500px; expose all three. */
export function images(url) {
  if (!url) return [];
  const m = url.match(/(\d+)x(\d+)/);
  if (!m) return [{ url }];
  return [50, 150, 500].map((s) => ({ url: url.replace(m[0], `${s}x${s}`), width: s, height: s }));
}

/** Artist credits: primary then featured, in JioSaavn's own order; falls back to the comma-separated subtitle. */
function credits(map, fallback) {
  const list = [...(map?.primary_artists ?? []), ...(map?.featured_artists ?? [])];
  if (list.length) {
    return list
      .filter((a) => a.name)
      .map((a) => ({ id: a.id ?? cleanText(a.name), name: cleanText(a.name) }));
  }
  return fallback
    ? fallback
        .split(',')
        .map((n) => cleanText(n))
        .filter(Boolean)
        .map((name) => ({ id: name, name }))
    : [];
}

/** A song. `over` sets the album and track number when they are known from the surrounding album page. */
export function trackView(s, over = {}) {
  const mi = s.more_info ?? {};
  return {
    id: s.id,
    title: cleanText(s.title),
    artists: credits(mi.artistMap, s.subtitle?.split(' - ')[0]),
    album: mi.album_id ? { id: mi.album_id, title: cleanText(mi.album), images: images(s.image) } : null,
    durationMs: mi.duration ? Number(mi.duration) * 1000 : null,
    explicit: s.explicit_content === '1',
    trackNumber: null,
    images: images(s.image),
    url: s.perma_url ?? null,
    ...over,
  };
}

/** An album. `trackCount` overrides the upstream count when the track list is at hand. */
export function albumView(a, trackCount) {
  const count = Number(a.more_info?.song_count ?? a.list_count ?? 0);
  const map = a.more_info?.artistMap;
  let artists = credits(map, a.subtitle);
  // Homepage album cards list their artists only under `artists`, with an empty role.
  if (!artists.length && map?.artists?.length) {
    artists = credits({ primary_artists: map.artists.filter((x) => !x.role) });
  }
  return {
    id: a.id,
    title: cleanText(a.title),
    albumType: count > 0 && count <= 2 ? 'single' : 'album',
    releaseDate: a.more_info?.release_date || a.year || null,
    label: a.more_info?.label || null,
    trackCount: trackCount || count || 0,
    explicit: a.explicit_content === '1',
    artists,
    images: images(a.image),
  };
}

export function playlistView(p) {
  return {
    id: p.id,
    title: cleanText(p.title),
    description: cleanText(p.header_desc) || null,
    trackCount: Number(p.more_info?.song_count ?? p.list_count ?? 0) || 0,
    images: images(p.image),
  };
}

export function artistView(a) {
  return { id: a.id ?? '', name: cleanText(a.name ?? a.title), images: images(a.image) };
}

/** One of JioSaavn's curated radio stations (a browse-list entry, not a listener's own seeded queue). */
export function stationView(s) {
  const mi = s.more_info ?? {};
  return {
    id: s.id,
    name: cleanText(s.title),
    subtitle: cleanText(s.subtitle) || null,
    images: images(s.image),
    language: mi.language ?? null,
  };
}

/** JioSaavn resolves a show by the token at the end of its `perma_url` (`.../talking-music/3/PjReFP-Sguk_`
 *  -> `PjReFP-Sguk_`), not by its plain numeric `id` — `GET /v1/podcasts/{token}` needs that token. */
function showToken(permaUrl) {
  const parts = (permaUrl ?? '').split('/').filter(Boolean);
  return parts.at(-1) || null;
}

/** search.getMoreResults's show hits list artists flat (`artists_id`/`artists_name`), not nested under an
 *  `artistMap` like everywhere else — reshape to what `credits()` expects. */
function artistMapFrom(s) {
  const flat = (list) => (list ?? []).map((a) => ({ id: a.id ?? a.artists_id, name: a.name ?? a.artists_name }));
  return { primary_artists: flat(s.primary_artists), featured_artists: flat(s.featured_artists) };
}

/** A podcast/show: the light browse-list entry, the richer `show_details` of one show (which alone
 *  carries `description` and `totalEpisodes`), or a search hit (flat artist list, `image_file_url`
 *  instead of `image`, `latest_season_sequence` instead of `more_info.season_number`). */
export function showView(s) {
  const mi = s.more_info ?? {};
  return {
    id: s.id,
    token: showToken(s.perma_url),
    title: cleanText(s.title),
    subtitle: cleanText(s.subtitle) || null,
    description: cleanText(mi.description) || null,
    artists: credits(mi.artistMap ?? artistMapFrom(s), s.subtitle),
    images: images(s.image ?? s.image_file_url),
    seasonNumber: Number(mi.season_number ?? s.latest_season_sequence) || null,
    totalEpisodes: mi.total_episodes ? Number(mi.total_episodes) : null,
    url: s.perma_url ?? null,
  };
}

/** One season of a show, as listed in its `seasons` array. */
export function seasonView(s) {
  const mi = s.more_info ?? {};
  return {
    id: s.id,
    title: cleanText(s.title),
    seasonNumber: mi.season_number ? Number(mi.season_number) : null,
    episodeCount: mi.numEpisodes ? Number(mi.numEpisodes) : null,
  };
}

/** A podcast episode. Kept separate from `trackView`: episodes carry season/episode/description fields a
 *  track doesn't, and skip the album/track-number ones a track does. Its `id` still works with the existing
 *  `/v1/tracks/{id}/audio` endpoint unchanged — JioSaavn's `song.getDetails` answers episode ids exactly
 *  like song ids. */
export function episodeView(e) {
  const mi = e.more_info ?? {};
  return {
    id: e.id,
    title: cleanText(e.title),
    description: cleanText(mi.description) || null,
    artists: credits(mi.artistMap, e.subtitle),
    durationMs: mi.duration ? Number(mi.duration) * 1000 : null,
    images: images(e.image),
    publishedAt: mi.release_date || null,
    seasonNumber: mi.season_no ? Number(mi.season_no) : null,
    episodeNumber: mi.episode_number ? Number(mi.episode_number) : null,
    url: e.perma_url ?? null,
  };
}
