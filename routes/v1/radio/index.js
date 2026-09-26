/** An endless-radio queue seeded by track:ID, artist:ID, album:ID or playlist:ID. */
const radio = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['seed'],
          properties: {
            seed: { type: 'string', minLength: 5, maxLength: 80 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            exclude: { type: 'string' },
          },
        },
      },
    },
    async (req) => {
      const exclude = (req.query.exclude ?? '').split(',').filter(Boolean).slice(0, 500);
      return fastify.discovery.radio(req.query.seed, req.query.limit, exclude);
    },
  );
};

export default radio;
