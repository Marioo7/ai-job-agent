import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@ajaa/shared': path.resolve(__dirname, 'shared/src/index.ts'),
      '@ajaa/core': path.resolve(__dirname, 'core/src/index.ts'),
    },
  },
  test: {
    include: ['{shared,core,backend,worker}/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    testTimeout: 20000,
  },
});
