import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { 'server-only': fileURLToPath(new URL('./test/support/empty.ts', import.meta.url)) },
  },
  test: {
    include: ['test/db/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    globalSetup: ['test/db/global-setup.ts'],
  },
});
