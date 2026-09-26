import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build } from '../helper.js';

describe('browser access to the library and playlist endpoints', () => {
  it('allows PATCH, PUT and DELETE in CORS preflight', async (t) => {
    const app = await build(t, { env: { CORS_ORIGINS: 'https://app.example.com' } });
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/v1/playlists/usr_00000000-0000-4000-8000-000000000000',
        headers: { origin: 'https://app.example.com', 'access-control-request-method': method },
      });
      assert.match(String(res.headers['access-control-allow-methods']), new RegExp(method), method);
    }
  });
});

describe('API key guessing', () => {
  it('is rate limited: wrong keys are counted before they are rejected', async (t) => {
    const app = await build(t, { env: { NAAD_API_KEY: 'secret-key-123', RATE_LIMIT_PER_MINUTE: '3' } });
    const codes = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        url: '/v1/search?q=x',
        headers: { authorization: 'Bearer wrong-key-000' },
      });
      codes.push(res.statusCode);
    }
    assert.deepEqual(codes, [401, 401, 401, 429, 429, 429]);
  });
});
