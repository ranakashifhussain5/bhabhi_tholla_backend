import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('loads valid env with defaults applied', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/db' });
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.DATABASE_URL).toBe('postgresql://localhost/db');
  });

  it('rejects env missing DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment configuration/);
  });

  it('coerces PORT from a string', () => {
    const config = loadConfig({ DATABASE_URL: 'x', PORT: '4000' });
    expect(config.PORT).toBe(4000);
  });
});
