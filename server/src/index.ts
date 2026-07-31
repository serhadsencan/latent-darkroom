import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ensureDirs, photoRoots, port } from './config.ts';
import { registerRoutes } from './routes.ts';

ensureDirs();

const app = Fastify({
  logger: { transport: undefined, level: 'warn' },
  // Large JPEGs are streamed, so the body limit can stay small.
  bodyLimit: 1024 * 1024,
});

await app.register(cors, { origin: true });
registerRoutes(app);

await app.listen({ port, host: '127.0.0.1' });

console.log(`latent-darkroom API  →  http://127.0.0.1:${port}`);
if (photoRoots.length === 0) {
  console.warn('⚠  PHOTO_ROOTS is empty. Copy .env.example to .env and set your photo folder.');
} else {
  console.log(`   roots: ${photoRoots.join(', ')}`);
}
