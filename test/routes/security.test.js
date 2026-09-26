import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build } from '../helper.js';

const auth = { authorization: 'Bearer secret-key-123' };

describe('API key', () => {
  it('is required on /v1 routes but not on health or artwork', async (t) => {
    const app = await build(t, { env: { NAAD_API_KEY: 'secret-key-123' } });
    assert.equal((await app.inject('/v1/search?q=x')).statusCode, 401);
    assert.equal(
      (await app.inject({ url: '/v1/search?q=x', headers: { authorization: 'Bearer wrong-key-1234' } }))
        .statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ url: '/v1/search?q=kesariya&types=track', headers: auth })).statusCode,
      200,
    );
    assert.equal((await app.inject('/healthz')).statusCode, 200);
    // artwork passes the key check (this host is then refused for another reason)
    assert.equal((await app.inject('/v1/art?src=https%3A%2F%2Fi.ytimg.com%2Fx.jpg')).statusCode, 400);
  });

  it('production refuses to start without one', async (t) => {
    await assert.rejects(build(t, { env: { NODE_ENV: 'production' } }), /NAAD_API_KEY/);
  });

  it('production may run open only when explicitly allowed', async (t) => {
    const app = await build(t, { env: { NODE_ENV: 'production', ALLOW_UNAUTHENTICATED: 'true' } });
    assert.equal((await app.inject('/healthz')).statusCode, 200);
  });
});

describe('rate limit', () => {
  it('returns 429 with Retry-After once the budget is spent', async (t) => {
    const app = await build(t, { env: { NAAD_API_KEY: 'secret-key-123', RATE_LIMIT_PER_MINUTE: '3' } });
    const codes = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await app.inject({ url: '/v1/search?q=kesariya&types=track', headers: auth })).statusCode);
    }
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    const last = await app.inject({ url: '/v1/search?q=kesariya&types=track', headers: auth });
    assert.ok(last.headers['retry-after']);
  });
});
