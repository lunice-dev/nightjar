import { defineConfig } from 'vitest/config';

// Tests for the interface's own logic (no browser, no engine): npm test
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
