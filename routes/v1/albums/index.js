const albums = async (fastify) => {
  fastify.get(
    '/:id',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 64 } } },
      },
    },
    async (req) => fastify.catalog.getAlbum(req.params.id),
  );
};

export default albums;
