import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const validEnv = {
  DATABASE_URL: 'postgresql://localhost/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('loadConfig', () => {
  it('loads valid env with defaults applied', () => {
    const config = loadConfig(validEnv);
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.DATABASE_URL).toBe('postgresql://localhost/db');
  });

  it('rejects env missing DATABASE_URL', () => {
    const { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET } = validEnv;
    expect(() => loadConfig({ JWT_ACCESS_SECRET, JWT_REFRESH_SECRET })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => loadConfig({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rejects identical JWT access and refresh secrets', () => {
    expect(() =>
      loadConfig({ ...validEnv, JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'a'.repeat(32) }),
    ).toThrow(/must not be the same value/);
  });

  it('coerces PORT from a string', () => {
    const config = loadConfig({ ...validEnv, PORT: '4000' });
    expect(config.PORT).toBe(4000);
  });
});
