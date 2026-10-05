import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';

import { trustedProxies } from '../../lib/client-ip.js';

/** The client IP Fastify derives for one request, with TRUST_PROXY set to `value`. */
async function ipFor(value, remoteAddress, xff) {
  const app = Fastify({ trustProxy: trustedProxies(value) });
  app.get('/', async (req) => ({ ip: req.ip }));
  const res = await app.inject({ url: '/', remoteAddress, headers: xff ? { 'x-forwarded-for': xff } : {} });
  await app.close();
  return res.json().ip;
}

describe('TRUST_PROXY', () => {
  it('maps the env value to Fastify trustProxy', () => {
    assert.equal(trustedProxies(undefined), false);
    assert.equal(trustedProxies(''), false);
    assert.equal(trustedProxies('false'), false);
    assert.equal(trustedProxies('true'), true);
    assert.equal(trustedProxies(' uniquelocal, 173.245.48.0/20 '), 'uniquelocal, 173.245.48.0/20');
  });

  it('with listed proxies, takes the address the trusted proxy saw and ignores what the client wrote', async () => {
    // The client forged 203.0.113.9; the platform proxy (10.0.0.5) appended the real address.
    assert.equal(await ipFor('uniquelocal', '10.0.0.5', '203.0.113.9, 49.36.10.20'), '49.36.10.20');
  });

  it('walks through every listed proxy hop (e.g. Cloudflare in front of a platform proxy)', async () => {
    const value = 'uniquelocal,173.245.48.0/20';
    assert.equal(await ipFor(value, '10.0.0.5', '203.0.113.9, 49.36.10.20, 173.245.48.7'), '49.36.10.20');
  });

  it('ignores X-Forwarded-For from a caller that is not a listed proxy', async () => {
    assert.equal(await ipFor('uniquelocal', '49.36.10.20', '203.0.113.9'), '49.36.10.20');
  });

  it('is spoofable with "true", which believes the leftmost entry', async () => {
    assert.equal(await ipFor('true', '10.0.0.5', '203.0.113.9, 49.36.10.20'), '203.0.113.9');
  });
});
