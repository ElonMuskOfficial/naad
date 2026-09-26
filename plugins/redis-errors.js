import { httpErrors } from '@fastify/sensible';
import fp from 'fastify-plugin';

/** ioredis reports an unreachable server as these; anything else (a bug, a bad script) stays a 500. */
/** @param {any} err */
const isOutage = (err) =>
  err?.name === 'MaxRetriesPerRequestError' ||
  /Connection is closed|Command timed out|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err?.message ?? '');

/**
 * A Redis outage is the client's "try again shortly" (503), not a server bug, and the driver's own text
 * ("Reached the max retries per request limit…") is not for clients. Everything else is passed on unchanged.
 * `reply.send(error)` inside an error handler hands the error to Fastify's default handler (which honours the
 * error's statusCode and headers); `fastify.errorHandler` would be this very handler and recurse.
 */
export default fp(
  async (fastify) => {
    fastify.setErrorHandler((/** @type {any} */ err, req, reply) => {
      if (isOutage(err)) {
        req.log.warn({ err: err.message }, 'redis unavailable');
        return reply.send(httpErrors.serviceUnavailable('A data store is unavailable, try again shortly'));
      }
      return reply.send(err);
    });
  },
  { name: 'redis-errors' },
);
