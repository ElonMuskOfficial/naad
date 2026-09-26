const player = async (fastify) => {
  /** Warms the audio lookups of upcoming queue items so playback starts without a wait. */
  fastify.post(
    '/prefetch',
    {
      schema: {
        body: {
          type: 'object',
          required: ['trackIds'],
          properties: {
            trackIds: {
              type: 'array',
              minItems: 1,
              maxItems: 10,
              items: { type: 'string', minLength: 1, maxLength: 64 },
            },
          },
        },
      },
    },
    async (req, reply) => {
      void fastify.audio.warm(req.body.trackIds).catch(() => {});
      return reply.code(202).send({ accepted: req.body.trackIds.length });
    },
  );
};

export default player;
