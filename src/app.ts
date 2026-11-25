import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AuthError,
  createGuestSession,
  linkEmailPassword,
  loginWithEmailPassword,
  refreshTokenPair,
  verifyToken,
} from './auth/index.js';
import type { JwtSecrets } from './auth/index.js';
import type { PrismaClient } from './generated/prisma/client.js';

export interface AppDeps {
  prisma: PrismaClient;
  jwtSecrets: JwtSecrets;
}

// Capped at 72 (the common bcrypt-era convention) so an arbitrarily long
// input can't make scrypt do proportionally more work - a trivial DoS vector.
const emailPasswordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
});
const refreshBodySchema = z.object({ refreshToken: z.string().min(1) });

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  const { prisma, jwtSecrets } = deps;

  // Awaited deliberately: routes defined before this plugin's onRequest
  // hook actually finishes registering do not reliably get rate-limited,
  // even though app.ready() later reports success either way.
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  app.get('/health', () => {
    return { status: 'ok' };
  });

  // Guest creation and login are the endpoints most worth throttling harder:
  // unlimited guest creation lets someone spam accounts, and login is a
  // brute-force target.
  app.post('/auth/guest', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async () => {
    return createGuestSession(prisma, jwtSecrets);
  });

  app.post(
    '/auth/refresh',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = refreshBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid-request' });

      try {
        return await refreshTokenPair(body.data.refreshToken, jwtSecrets);
      } catch {
        return reply.code(401).send({ error: 'invalid-refresh-token' });
      }
    },
  );

  app.post(
    '/auth/link',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = await requireUserId(request, jwtSecrets);
      if (!userId) return reply.code(401).send({ error: 'unauthorized' });

      const body = emailPasswordSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid-request' });

      try {
        await linkEmailPassword(prisma, userId, body.data.email, body.data.password);
        return { ok: true };
      } catch (err) {
        if (err instanceof AuthError) return reply.code(409).send({ error: err.reason });
        throw err;
      }
    },
  );

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = emailPasswordSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid-request' });

      try {
        return await loginWithEmailPassword(prisma, jwtSecrets, body.data.email, body.data.password);
      } catch (err) {
        if (err instanceof AuthError) return reply.code(401).send({ error: err.reason });
        throw err;
      }
    },
  );

  return app;
}

async function requireUserId(request: FastifyRequest, jwtSecrets: JwtSecrets): Promise<string | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;

  try {
    return await verifyToken(header.slice('Bearer '.length), jwtSecrets.accessSecret, 'access');
  } catch {
    return null;
  }
}
