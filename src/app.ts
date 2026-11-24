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

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  const { prisma, jwtSecrets } = deps;

  app.get('/health', () => {
    return { status: 'ok' };
  });

  app.post('/auth/guest', async () => {
    return createGuestSession(prisma, jwtSecrets);
  });

  app.post('/auth/refresh', async (request, reply) => {
    const body = refreshBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid-request' });

    try {
      return await refreshTokenPair(body.data.refreshToken, jwtSecrets);
    } catch {
      return reply.code(401).send({ error: 'invalid-refresh-token' });
    }
  });

  app.post('/auth/link', async (request, reply) => {
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
  });

  app.post('/auth/login', async (request, reply) => {
    const body = emailPasswordSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid-request' });

    try {
      return await loginWithEmailPassword(prisma, jwtSecrets, body.data.email, body.data.password);
    } catch (err) {
      if (err instanceof AuthError) return reply.code(401).send({ error: err.reason });
      throw err;
    }
  });

  return app;
}

async function requireUserId(request: FastifyRequest, jwtSecrets: JwtSecrets): Promise<string | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;

  try {
    return await verifyToken(header.slice('Bearer '.length), jwtSecrets.accessSecret);
  } catch {
    return null;
  }
}
