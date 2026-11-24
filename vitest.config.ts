import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['dotenv/config'],
    // DB-backed tests share one real Postgres database and reset it between
    // tests; running test files in parallel would let one file's reset wipe
    // rows another file's test just created. Simplest fix: no file parallelism.
    fileParallelism: false,
  },
});
