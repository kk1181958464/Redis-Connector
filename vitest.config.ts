import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['core/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './core'),
    },
  },
});
