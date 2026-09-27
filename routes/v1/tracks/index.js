const params = {
  type: 'object',
  properties: { id: { type: 'string', minLength: 3, maxLength: 64 } },
};
const quality = { type: 'string', enum: ['max', '320', '160', '96'], default: 'max' };

const tracks = async (fastify) => {
  fastify.get('/:id', { schema: { params } }, async (req) => fastify.catalog.getTrack(req.params.id));

  /** The audio file of a track: a static CDN URL, its bitrate and duration. */
  fastify.get(
    '/:id/audio',
    {
      schema: {
        params,
        querystring: {
          type: 'object',
          properties: { quality, refresh: { type: 'boolean', default: false } },
        },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return fastify.audio.get(req.params.id, req.query.quality, req.query.refresh);
    },
  );

  /** Time-synced lyrics from LRCLIB. */
  fastify.get('/:id/lyrics', { schema: { params } }, async (req, reply) => {
    const data = await fastify.lyrics.get(req.params.id);
    reply.header('cache-control', 'public, max-age=86400');
    return data;
  });
};

export default tracks;
