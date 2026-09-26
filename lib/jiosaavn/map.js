import { cleanText } from '../text.js';

/** JioSaavn serves the same artwork at 50/150/500px; expose all three. */
export function images(url) {
  if (!url) return [];
  const m = url.match(/(\d+)x(\d+)/);
  if (!m) return [{ url }];
  return [50, 150, 500].map((s) => ({ url: url.replace(m[0], `${s}x${s}`), width: s, height: s }));
}

/** Artist credits: primary then featured, de-duplicated; falls back to the comma-separated subtitle. */
function credits(map, fallback) {
  const list = [...(map?.primary_artists ?? []), ...(map?.featured_artists ?? [])];
  if (list.length) {
    const seen = new Set();
    return list
      .filter((a) => a.name && !seen.has(a.id ?? a.name) && seen.add(a.id ?? a.name))
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
