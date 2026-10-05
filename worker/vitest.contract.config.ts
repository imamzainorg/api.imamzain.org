import { defineConfig } from 'vitest/config';

// Black-box HTTP suite. Needs BASE_URL and DATABASE_URL: run it through `npm run contract` or
// `npm run check:<group>`, which start the servers and run it once per target.
// Inside tests Vitest sets process.env.BASE_URL to Vite's base path ('/'), so the target is read here
// and handed over as CONTRACT_TARGET.
const target = process.env.BASE_URL;

export default defineConfig({
  test: {
    include: ['test/contract/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    env: target ? { CONTRACT_TARGET: target } : {},
  },
});
