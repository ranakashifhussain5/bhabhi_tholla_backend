import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { prisma } from './db/client.js';
import { resetDb } from './db/testHelpers.js';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface GuestSessionBody {
  userId: string;
  tokens: TokenPair;
}

const jwtSecrets = { accessSecret: 'a'.repeat(32), refreshSecret: 'b'.repeat(32) };

function makeApp() {
  return buildApp({ prisma, jwtSecrets });
}

function asGuestSession(response: LightMyRequestResponse): GuestSessionBody {
  return response.json<GuestSessionBody>();
}

function asTokenPair(response: LightMyRequestResponse): TokenPair {
  return response.json<TokenPair>();
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /health', () => {
  it('returns ok status', async () => {
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /auth/guest', () => {
  it('creates a new guest user and returns a token pair', async () => {
    const app = await makeApp();
    const response = await app.inject({ method: 'POST', url: '/auth/guest' });

    expect(response.statusCode).toBe(200);
    const body = asGuestSession(response);
    expect(body.userId).toBeTruthy();
    expect(body.tokens.accessToken).toBeTruthy();
    expect(body.tokens.refreshToken).toBeTruthy();
  });

  it('rate-limits repeated guest creation from the same client', async () => {
    const app = await makeApp();

    for (let i = 0; i < 10; i++) {
      const response = await app.inject({ method: 'POST', url: '/auth/guest' });
      expect(response.statusCode).toBe(200);
    }

    const limited = await app.inject({ method: 'POST', url: '/auth/guest' });
    expect(limited.statusCode).toBe(429);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates a valid refresh token', async () => {
    const app = await makeApp();
    const guest = asGuestSession(await app.inject({ method: 'POST', url: '/auth/guest' }));

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: guest.tokens.refreshToken },
    });

    expect(response.statusCode).toBe(200);
    expect(asTokenPair(response).accessToken).toBeTruthy();
  });

  it('rejects a malformed request body', async () => {
    const app = await makeApp();
    const response = await app.inject({ method: 'POST', url: '/auth/refresh', payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an invalid refresh token', async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /auth/link and /auth/login', () => {
  it('links email/password to a guest, then logs in with them', async () => {
    const app = await makeApp();
    const guest = asGuestSession(await app.inject({ method: 'POST', url: '/auth/guest' }));

    const linkResponse = await app.inject({
      method: 'POST',
      url: '/auth/link',
      headers: { authorization: `Bearer ${guest.tokens.accessToken}` },
      payload: { email: 'player@example.com', password: 'password123' },
    });
    expect(linkResponse.statusCode).toBe(200);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'player@example.com', password: 'password123' },
    });
    expect(loginResponse.statusCode).toBe(200);
    expect(asTokenPair(loginResponse).accessToken).toBeTruthy();
  });

  it('rejects a password over the length cap', async () => {
    const app = await makeApp();
    const guest = asGuestSession(await app.inject({ method: 'POST', url: '/auth/guest' }));

    const response = await app.inject({
      method: 'POST',
      url: '/auth/link',
      headers: { authorization: `Bearer ${guest.tokens.accessToken}` },
      payload: { email: 'toolong@example.com', password: 'a'.repeat(73) },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects linking without a valid access token', async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/link',
      payload: { email: 'nope@example.com', password: 'password123' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects linking an email already in use', async () => {
    const app = await makeApp();
    const first = asGuestSession(await app.inject({ method: 'POST', url: '/auth/guest' }));
    const second = asGuestSession(await app.inject({ method: 'POST', url: '/auth/guest' }));

    await app.inject({
      method: 'POST',
      url: '/auth/link',
      headers: { authorization: `Bearer ${first.tokens.accessToken}` },
      payload: { email: 'taken@example.com', password: 'password123' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/link',
      headers: { authorization: `Bearer ${second.tokens.accessToken}` },
      payload: { email: 'taken@example.com', password: 'password456' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('rejects login with the wrong password', async () => {
    const app = await makeApp();
    const guest = asGuestSession(await app.inject({ method: 'POST', url: '/auth/guest' }));
    await app.inject({
      method: 'POST',
      url: '/auth/link',
      headers: { authorization: `Bearer ${guest.tokens.accessToken}` },
      payload: { email: 'wrongpass@example.com', password: 'password123' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'wrongpass@example.com', password: 'not-it-either' },
    });
    expect(response.statusCode).toBe(401);
  });
});
