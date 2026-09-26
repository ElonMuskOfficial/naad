/** The home feed, mirroring the JioSaavn homepage. */
const home = async (fastify) => {
  fastify.get('/', async () => ({ sections: await fastify.discovery.home() }));
};

export default home;
