import { cleanText } from '../text.js';
import { albumView, artistView, playlistView, trackView } from './map.js';

/** JioSaavn item `type` -> the kind our clients can render, and the view that builds it. Anything
 *  else (shows, radio stations) is skipped: we have no page or type for those. */
const KIND_OF_TYPE = {
  song: 'track',
  album: 'album',
  playlist: 'playlist',
  artist: 'artist',
};
const VIEW_OF_KIND = {
  track: trackView,
  album: albumView,
  playlist: playlistView,
  artist: artistView,
};

/**
 * Turns JioSaavn's `webapi.getLaunchData` into home sections, mirroring the JioSaavn homepage: the
 * same modules, in the same order, with the same titles.
 *
 * A module's items keep JioSaavn's own order and their own kind, mixed types included (JioSaavn's
 * homepage itself interleaves a song card between two album cards in one row, rather than splitting
 * a module by type) — a naad clone must not turn that into a same-type-only shelf and drop the rest.
 * Only items of a kind we have no page or type for (podcasts, radio stations) are left out.
 */
export function sectionsFromLaunchData(data) {
  const modules = Object.values(data.modules ?? {}).sort((a, b) => a.position - b.position);
  const sections = [];
  for (const mod of modules) {
    const raw = data[mod.source];
    if (!Array.isArray(raw)) continue;

    const seen = new Set();
    const items = [];
    for (const entry of raw) {
      const kind = entry.type ? KIND_OF_TYPE[entry.type] : undefined;
      if (!kind || !entry.id) continue;
      const key = `${kind}:${entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ kind, item: VIEW_OF_KIND[kind](entry) });
    }

    const title = cleanText(mod.title);
    if (!items.length || !title) continue;
    sections.push({
      id: mod.source.replace(/[^a-z0-9]+/gi, '-'),
      title,
      subtitle: cleanText(mod.subtitle) || undefined,
      items,
    });
  }
  return sections;
}
