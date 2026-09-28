import { stationView } from './map.js';

/**
 * JioSaavn's curated radio stations (mood/language/artist presets like "Unlimited Khushiyan"), mirrored
 * as-is: browse the catalog, start one, and pull its next batch of songs.
 */
export class Stations {
  jiosaavn;

  constructor(jiosaavn) {
    this.jiosaavn = jiosaavn;
  }

  async browse(language) {
    const data = await this.jiosaavn.browseModules(language);
    // `featured_stations` also carries "artist radio" presets (`more_info.featured_station_type === 'artist'`)
    // for languages with enough catalog — JioSaavn ships these with no `id` (and no `perma_url`), meaning
    // "resolve me by artist name", not "here's a station". We don't support that resolution, and passing the
    // blank id straight through gave every such entry the same empty id — which crashed the client's keyed
    // list (duplicate keys) as soon as a language's curation included more than one.
    return (data.radio?.featured_stations ?? []).filter((s) => s.id).map(stationView);
  }

  async create(name, language) {
    return this.jiosaavn.createStation(name, language);
  }

  async songs(stationId, limit) {
    return this.jiosaavn.getStationSongs(stationId, limit);
  }
}
