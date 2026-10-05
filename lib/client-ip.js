import { AsyncLocalStorage } from 'node:async_hooks';
import { BlockList, isIP } from 'node:net';

/**
 * The listener's public IP for the request being served, so upstream calls can say who they are made for.
 * JioSaavn localizes search and browse by the caller's location and trusts X-Forwarded-For; without it, it
 * places the server, and a server outside India gets a catalog that misses songs an Indian listener sees.
 */
const store = new AsyncLocalStorage();

/** Addresses no geolocation can place: private, loopback, link-local, carrier-grade NAT, unique-local. */
const LOCAL = new BlockList();
LOCAL.addSubnet('0.0.0.0', 8, 'ipv4');
LOCAL.addSubnet('10.0.0.0', 8, 'ipv4');
LOCAL.addSubnet('100.64.0.0', 10, 'ipv4');
LOCAL.addSubnet('127.0.0.0', 8, 'ipv4');
LOCAL.addSubnet('169.254.0.0', 16, 'ipv4');
LOCAL.addSubnet('172.16.0.0', 12, 'ipv4');
LOCAL.addSubnet('192.168.0.0', 16, 'ipv4');
LOCAL.addSubnet('::', 127, 'ipv6'); // :: and ::1
LOCAL.addSubnet('fc00::', 7, 'ipv6');
LOCAL.addSubnet('fe80::', 10, 'ipv6');

/** `ip` if it is a public address worth forwarding (an IPv4-mapped IPv6 one as plain IPv4), else null. */
export function publicIp(ip) {
  const addr = ip?.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const family = isIP(addr ?? '');
  if (!family) return null;
  return LOCAL.check(addr, family === 4 ? 'ipv4' : 'ipv6') ? null : addr;
}

/**
 * TRUST_PROXY as Fastify's `trustProxy`: the proxies allowed to report the client address. List your own
 * (IPs/CIDRs, or `loopback`, `linklocal`, `uniquelocal`); only X-Forwarded-For entries they appended are
 * believed, so a client can't choose the IP that keys its rate limit or that JioSaavn localizes by.
 * `true` believes every entry, including one the client wrote itself.
 */
export function trustedProxies(value) {
  const v = value?.trim();
  if (!v || v === 'false') return false;
  return v === 'true' ? true : v;
}

/** Runs `fn` (the rest of the request) with `ip` as the current listener. */
export function runWithClientIp(ip, fn) {
  return store.run(publicIp(ip), fn);
}

/** The current listener's public IP, or null outside a request or for a local caller. */
export function clientIp() {
  return store.getStore() ?? null;
}
