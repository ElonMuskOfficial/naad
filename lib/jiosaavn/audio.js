import { httpErrors } from '@fastify/sensible';
import { desEcbDecrypt } from './des.js';

const MEDIA_KEY = new TextEncoder().encode('38346591');

/** Decrypts `encrypted_media_url` into the CDN URL. Bitrate variants differ only in the `_NN.mp4` suffix. */
export function decryptMedia(song) {
  const enc = song.more_info?.encrypted_media_url;
  if (!enc) return null;
  const url = new TextDecoder().decode(desEcbDecrypt(Uint8Array.from(Buffer.from(enc, 'base64')), MEDIA_KEY));
  if (!/^https?:\/\//.test(url)) return null;
  return { baseUrl: url.replace(/^http:/, 'https:'), has320: song.more_info?.['320kbps'] === 'true' };
}

export function mediaVariant(media, kbps) {
  return media.baseUrl.replace(/_(\d+)\.mp4$/, `_${kbps}.mp4`);
}

const MEDIA_TTL_SEC = 24 * 3600;

/** Turns a JioSaavn song id into the URL of its audio file, by decrypting the song's `encrypted_media_url`. */
export class Audio {
  jiosaavn;
  cache;

  constructor(jiosaavn, cache) {
    this.jiosaavn = jiosaavn;
    this.cache = cache;
  }

  async media(trackId, refresh) {
    const key = `audio:v2:${trackId}`;
    if (!refresh) {
      const cached = await this.cache.get(key);
      if (cached) return cached;
    }
    const song = await this.jiosaavn.getSongRaw(trackId);
    const media = decryptMedia(song);
    if (!media) throw httpErrors.notFound(`Audio is not available for track ${trackId}`);
    const value = {
      baseUrl: media.baseUrl,
      has320: media.has320,
      durationMs: song.more_info?.duration ? Number(song.more_info.duration) * 1000 : null,
    };
    void this.cache.set(key, value, MEDIA_TTL_SEC);
    return value;
  }

  async get(trackId, quality = 'max', refresh = false) {
    const media = await this.media(trackId, refresh);
    const bitrateKbps = quality === '96' ? 96 : quality === '160' ? 160 : media.has320 ? 320 : 160;
    return {
      trackId,
      url: mediaVariant({ baseUrl: media.baseUrl, has320: media.has320 }, bitrateKbps),
      mimeType: 'audio/mp4',
      codec: 'aac',
      bitrateKbps,
      durationMs: media.durationMs,
    };
  }

  /** Warms the cache for upcoming queue items so playback starts without a lookup. */
  async warm(trackIds) {
    await Promise.allSettled(trackIds.slice(0, 10).map((id) => this.media(id, false)));
  }
}
