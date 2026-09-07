import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure functions only: nothing here opens a socket or imports Next.js.
    include: ['src/**/*.test.ts'],
  },
});
