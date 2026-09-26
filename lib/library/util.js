/** One hash holds the JSON snapshots of everything the library refers to: `t:<id>`, `a:<id>`, `r:<id>`, `p:<id>`. */
export const SNAP = 'lib:snap';

/**
 * Mutations answer 200 with an empty body (schema.d.ts). Fastify rejects an async handler that resolves with
 * `undefined`, so send explicitly.
 */
export const ok = (reply) => reply.code(200).send();

/** Runs a MULTI and returns each command's value; ioredis resolves exec() with per-command errors, so throw the first. */
export async function exec(tx) {
  const results = (await tx.exec()) ?? [];
  for (const [err] of results) if (err) throw err;
  return results.map(([, value]) => value);
}
