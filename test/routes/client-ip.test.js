import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build, fakeUpstream } from '../helper.js';

// JioSaavn picks results by the caller's location (it trusts X-Forwarded-For), so naad forwards the
// listener's own IP rather than letting JioSaavn place the server.
describe('forwarding the listener IP to JioSaavn', () => {
  const xff = (up, call) => up.headers[up.calls.lastIndexOf(call)]?.['x-forwarded-for'];

  it('sends the caller IP as X-Forwarded-For on JioSaavn calls', async (t) => {
    const up = fakeUpstream();
    const app = await build(t, { fetch: up.fetch });
    const res = await app.inject({ url: '/v1/search?q=kesariya&types=track', remoteAddress: '49.36.10.20' });
    assert.equal(res.statusCode, 200);
    assert.equal(xff(up, 'search.getResults'), '49.36.10.20');
  });

  it('forwards an IPv6 caller too', async (t) => {
    const up = fakeUpstream();
    const app = await build(t, { fetch: up.fetch });
    await app.inject({ url: '/v1/home', remoteAddress: '2409:40c1:1:2::3' });
    assert.equal(xff(up, 'webapi.getLaunchData'), '2409:40c1:1:2::3');
  });

  it('forwards the IPv4 inside an IPv4-mapped IPv6 address', async (t) => {
    const up = fakeUpstream();
    const app = await build(t, { fetch: up.fetch });
    await app.inject({ url: '/v1/search?q=kesariya&types=track', remoteAddress: '::ffff:49.36.10.20' });
    assert.equal(xff(up, 'search.getResults'), '49.36.10.20');
  });

  it('sends nothing for a private or loopback caller (local use), so JioSaavn places the server', async (t) => {
    for (const remoteAddress of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '::1', 'fd00::1']) {
      const up = fakeUpstream();
      const app = await build(t, { fetch: up.fetch });
      await app.inject({ url: '/v1/search?q=kesariya&types=track', remoteAddress });
      assert.equal(xff(up, 'search.getResults'), undefined, remoteAddress);
    }
  });

  it('keeps per-call headers such as the language cookie', async (t) => {
    const up = fakeUpstream();
    const app = await build(t, { fetch: up.fetch });
    await app.inject({ url: '/v1/stations?language=tamil', remoteAddress: '49.36.10.20' });
    const i = up.calls.lastIndexOf('content.getBrowseModules');
    assert.equal(up.headers[i]?.cookie, 'L=tamil; DL=tamil');
    assert.equal(up.headers[i]?.['x-forwarded-for'], '49.36.10.20');
  });
});
