import { cleanText } from '../text.js';
import { albumView, artistView, playlistView, trackView } from './map.js';

/** JioSaavn item `type` -> the section kind our clients can render. Anything else (shows, radio stations) is skipped. */
const KIND_OF_TYPE = {
  song: 'tracks',
  album: 'albums',
  playlist: 'playlists',
  artist: 'artists',
};
/** Tie-break order when a module holds equal numbers of two kinds. */
const KIND_ORDER = ['tracks', 'albums', 'playlists', 'artists'];

function buildItems(kind, items) {
  const seen = new Set();
  const unique = items.filter((i) => i.id && !seen.has(i.id) && seen.add(i.id));
  switch (kind) {
    case 'tracks':
      return unique.map((i) => trackView(i));
    case 'albums':
      return unique.map((i) => albumView(i));
    case 'playlists':
      return unique.map((i) => playlistView(i));
    case 'artists':
      return unique.map((i) => artistView(i));
  }
}

/**
 * Turns JioSaavn's `webapi.getLaunchData` into home sections, mirroring the JioSaavn homepage: the
 * same modules, in the same order, with the same titles.
 *
 * Our clients render one kind per shelf, so a module holding a mix of item types keeps its most
 * common type (ties go tracks, albums, playlists, artists). Modules with nothing we can play or open
 * (podcasts, radio stations) are skipped.
 */
export function sectionsFromLaunchData(data) {
  const modules = Object.values(data.modules ?? {}).sort((a, b) => a.position - b.position);
  const sections = [];
  for (const mod of modules) {
    const raw = data[mod.source];
    if (!Array.isArray(raw)) continue;
    const items = raw;

    const counts = new Map();
    for (const item of items) {
      const kind = item.type ? KIND_OF_TYPE[item.type] : undefined;
      if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const kind = KIND_ORDER.filter((k) => counts.has(k)).sort((a, b) => counts.get(b) - counts.get(a))[0];
    if (!kind) continue;

    const built = buildItems(
      kind,
      items.filter((i) => i.type && KIND_OF_TYPE[i.type] === kind),
    );
    const title = cleanText(mod.title);
    if (!built.length || !title) continue;
    sections.push({
      id: mod.source.replace(/[^a-z0-9]+/gi, '-'),
      title,
      subtitle: cleanText(mod.subtitle) || undefined,
      kind,
      items: built,
    });
  }
  return sections;
}
