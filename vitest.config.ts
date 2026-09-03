import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@h3storyboard/protocol': fileURLToPath(
        new URL('./packages/protocol/src/index.ts', import.meta.url),
      ),
      '@h3storyboard/film-studio-bridge': fileURLToPath(
        new URL('./packages/film-studio-bridge/src/index.ts', import.meta.url),
      ),
      '@h3storyboard/task-engine': fileURLToPath(
        new URL('./packages/task-engine/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    fileParallelism: false,
  },
});
