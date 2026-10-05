import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // test/contract needs running servers: see vitest.contract.config.ts.
  test: { include: ['test/**/*.test.ts'], exclude: [...configDefaults.exclude, 'test/contract/**'] },
});
