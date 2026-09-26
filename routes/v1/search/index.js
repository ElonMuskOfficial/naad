const TYPES = ['track', 'album', 'artist', 'playlist'];

const search = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 200 },
            types: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            offset: { type: 'integer', minimum: 0, maximum: 200, default: 0 },
          },
        },
      },
    },
    async (req) => {
      const { q, limit, offset } = req.query;
      const types = req.query.types ? req.query.types.split(',').map((t) => t.trim()) : TYPES;
      if (!types.every((t) => TYPES.includes(t))) {
        throw fastify.httpErrors.badRequest(`types must be a comma separated list of: ${TYPES.join(', ')}`);
      }
      return fastify.catalog.search(q, types, limit, offset);
    },
  );
};

export default search;
