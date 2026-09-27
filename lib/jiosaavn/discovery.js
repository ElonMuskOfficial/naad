import { sectionsFromLaunchData } from './home.js';

/** The home feed, built from JioSaavn's own response. */
export class Discovery {
  jiosaavn;

  constructor(jiosaavn) {
    this.jiosaavn = jiosaavn;
  }

  /**
   * The home feed mirrors the JioSaavn homepage. One upstream call (`webapi.getLaunchData`) returns every
   * module; the RAW response is cached (gzipped, 10 min) inside `JioSaavnClient.launchData`, and mapping it
   * into sections is cheap.
   */
  async home() {
    return sectionsFromLaunchData(await this.jiosaavn.launchData());
  }
}
