const language = { type: 'string', minLength: 2, maxLength: 20 };

/** JioSaavn's podcast/show catalog. Episode audio is served by the existing `/v1/tracks/{id}/audio`. */
const podcasts = async (fastify) => {
  /** The show catalog (trending and all original podcasts). */
  fastify.get(
    '/',
    { schema: { querystring: { type: 'object', properties: { language } } } },
    async (req) => ({ shows: await fastify.podcasts.browse(req.query.language) }),
  );

  /** One show's details, seasons and episodes. `season` omitted asks JioSaavn for its default (the latest). */
  fastify.get(
    '/:token',
    {
      schema: {
        params: { type: 'object', properties: { token: { type: 'string', minLength: 1, maxLength: 100 } } },
        querystring: {
          type: 'object',
          properties: { season: { type: 'integer', minimum: 1, maximum: 200 } },
        },
      },
    },
    async (req) => fastify.podcasts.getShow(req.params.token, req.query.season),
  );
};

export default podcasts;
