import { httpErrors } from '@fastify/sensible';

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const TIMEOUT_MS = 8000;

/**
 * GET-JSON for one upstream, using the global `fetch`. A 404 becomes a 404 for our caller; any other failure
 * (network, timeout, 5xx, bad JSON) is retried once and then reported as 502/504.
 */
export function jsonClient(name, fetchImpl = fetch, headers = {}) {
  return async (url, signal) => {
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      try {
        const res = await fetchImpl(url, {
          headers: { 'user-agent': BROWSER_UA, accept: 'application/json', ...headers },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (res.status === 404 || res.status === 410) {
          await res.body?.cancel();
          throw httpErrors.notFound(`${name}: not found`);
        }
        if (!res.ok) {
          await res.body?.cancel();
          throw new Error(`HTTP ${res.status}`);
        }
        return await res.json();
      } catch (err) {
        if (err instanceof httpErrors.HttpError) throw err;
        if (signal?.aborted) throw err;
        if (attempt >= 1) {
          throw timeout.aborted
            ? httpErrors.gatewayTimeout(`${name} timed out`)
            : httpErrors.badGateway(`${name} failed: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 100));
      }
    }
  };
}
