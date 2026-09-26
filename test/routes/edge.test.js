import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build } from '../helper.js';

describe('edge inputs', () => {
  it('searches with a Devanagari query', async (t) => {
    const app = await build(t);
    const q = encodeURIComponent('तेरी मिट्टी');
    const res = await app.inject(`/v1/search?q=${q}&types=track`);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.json().tracks));
  });

  it('answers 502 in the Fastify error format when JioSaavn returns 5xx', async (t) => {
    const app = await build(t, { fetch: async () => new Response('boom', { status: 500 }) });
    const res = await app.inject('/v1/tracks/rjkrTnma');
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().statusCode, 502);
    assert.equal(typeof res.json().message, 'string');
  });

  it('rejects a bearer token of the wrong length with 401, not 500', async (t) => {
    const app = await build(t, { env: { NAAD_API_KEY: 'secret-key-123' } });
    const res = await app.inject({ url: '/v1/search?q=x', headers: { authorization: 'Bearer x' } });
    assert.equal(res.statusCode, 401);
  });
});

describe('the home feed is not cached by the browser', () => {
  it('sends no max-age for the home feed (Redis caches upstream, the web app caches per session)', async (t) => {
    const app = await build(t);
    for (const url of ['/v1/home']) {
      const res = await app.inject(url);
      assert.equal(res.statusCode, 200, url);
      assert.doesNotMatch(String(res.headers['cache-control'] ?? ''), /max-age|public/, url);
    }
  });
});

describe('search caching', () => {
  it('is not cached by the browser (Redis already caches upstream; a browser copy went stale after changes)', async (t) => {
    const app = await build(t);
    const res = await app.inject('/v1/search?q=kesariya&types=track');
    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(String(res.headers['cache-control'] ?? ''), /max-age|public|stale-while-revalidate/);
  });
});
