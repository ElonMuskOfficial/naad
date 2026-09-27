import { showView } from './map.js';

/**
 * JioSaavn's podcast/show catalog, mirrored as-is: browse shows and fetch one show's seasons and episodes.
 * Episode audio needs no code of its own — `/v1/tracks/{episodeId}/audio` already resolves it, since
 * JioSaavn's `song.getDetails` (which `Audio` calls) answers episode ids exactly like song ids.
 */
export class Podcasts {
  jiosaavn;

  constructor(jiosaavn) {
    this.jiosaavn = jiosaavn;
  }

  async browse(language) {
    const data = await this.jiosaavn.browseModules(language);
    return (data.top_shows?.shows ?? []).map(showView);
  }

  async getShow(token, season) {
    return this.jiosaavn.getShow(token, season);
  }
}
