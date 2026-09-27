const DEFAULT_TYPES = ['track', 'album', 'artist', 'playlist'];
// `show` (JioSaavn's podcasts) is opt-in only: an unfiltered search keeps its existing four types, so
// this doesn't change what any existing caller gets back.
const ALL_TYPES = [...DEFAULT_TYPES, 'show'];

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
      const types = req.query.types ? req.query.types.split(',').map((t) => t.trim()) : DEFAULT_TYPES;
      if (!types.every((t) => ALL_TYPES.includes(t))) {
        throw fastify.httpErrors.badRequest(
          `types must be a comma separated list of: ${ALL_TYPES.join(', ')}`,
        );
      }
      return fastify.catalog.search(q, types, limit, offset);
    },
  );
};

export default search;
