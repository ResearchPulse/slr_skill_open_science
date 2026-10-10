import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
