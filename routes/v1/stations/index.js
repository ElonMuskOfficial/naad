const language = { type: 'string', minLength: 2, maxLength: 20 };

/** JioSaavn's curated radio stations. */
const stations = async (fastify) => {
  /** The station catalog (mood/language/artist presets). */
  fastify.get(
    '/',
    { schema: { querystring: { type: 'object', properties: { language } } } },
    async (req) => ({ stations: await fastify.stations.browse(req.query.language) }),
  );

  /** Starts a station by the `name` a catalog entry gave you. */
  fastify.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, language },
        },
      },
    },
    async (req, reply) => {
      const stationId = await fastify.stations.create(req.body.name, req.body.language);
      reply.code(201);
      return { stationId };
    },
  );

  /** The next batch of songs from a station started above. */
  fastify.get(
    '/:id/songs',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 200 } } },
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        },
      },
    },
    async (req) => ({ tracks: await fastify.stations.songs(req.params.id, req.query.limit) }),
  );
};

export default stations;
