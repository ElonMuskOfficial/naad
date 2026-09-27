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
    return (data.radio?.featured_stations ?? []).map(stationView);
  }

  async create(name, language) {
    return this.jiosaavn.createStation(name, language);
  }

  async songs(stationId, limit) {
    return this.jiosaavn.getStationSongs(stationId, limit);
  }
}
