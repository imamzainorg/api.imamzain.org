// @ts-check
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  {
    // Generated / vendored output — never lint these.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'prisma/migrations/**'],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'prisma/**/*.ts'],
    // Core ESLint's own recommended set (no-fallthrough, no-empty,
    // no-unreachable, use-isnan, ...) layered under typescript-eslint's —
    // typescript-eslint's recommended config only covers TS-specific rules,
    // it doesn't include core JS bug-pattern checks on its own.
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      // src/**/*.ts is written entirely in import/export syntax, not
      // require()/module.exports — 'commonjs' here was a copy-paste mistake.
      sourceType: 'module',
    },
    rules: {
      // `{ known, ...rest }` destructuring solely to drop `known` before
      // spreading `rest` is a real, recurring pattern in this codebase
      // (sentry-scrub.util.ts, books.service.ts, contest.service.spec.ts) —
      // not dead code, so it shouldn't need an error suppressed per call site.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // 311 pre-existing findings as of the 2026-09 lint baseline — far past
      // the threshold for a small, reviewable diff to mass-fix. Kept visible
      // as a warning rather than silenced; see recommendedNextSteps.
      // `npm run lint` is NOT clean even with the downgrade above: two other
      // rules still fail on pre-existing, correct code (Prisma's own
      // `GetPayload<{}>` idiom in settings.service.ts, and Twilio's
      // required `import x = require()` CJS interop in whatsapp.service.ts)
      // — both reviewed and left as visible errors on purpose rather than
      // rule-wide exceptions for one call site each. Whoever wires `lint`
      // into CI needs to either add a scoped eslint-disable at those two
      // lines or accept a non-zero exit until then.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Not part of either "recommended" set, but explicitly worth catching:
      // `null: 'ignore'` keeps the codebase's existing `!= null`/`== null`
      // idiom (checks null AND undefined in one comparison) legal.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  // Must stay last: turns off ESLint stylistic rules that would conflict
  // with Prettier, which owns formatting separately (`npm run format`).
  eslintConfigPrettier,
);
