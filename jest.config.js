module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    // exclude integration specs — those run under jest.integration.config.js
    testPathIgnorePatterns: ['\\.integration\\.spec\\.ts$'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    },
    // Without this, untested files are simply absent from the report instead
    // of counting against it — 134+ source files were invisible. DTOs and
    // modules are declarative wiring/boilerplate with no branches to cover;
    // main.ts is bootstrap code exercised by nothing short of actually
    // starting the server.
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.spec.ts',
        '!src/**/*.dto.ts',
        '!src/**/*.module.ts',
        '!src/main.ts',
        '!src/**/index.ts',
    ],
    // Ratchet, not a target: a few points below the actual baseline measured
    // 2026-09-27 (statements 71.09%, branches 68.82%, functions 64.98%,
    // lines 72.09% via `npm run test:cov`), so a regression fails CI
    // without blocking on today's number. Raise this as coverage improves —
    // never lower it to make a red build pass.
    coverageThreshold: {
        global: {
            statements: 68,
            branches: 65,
            functions: 61,
            lines: 69,
        },
    },
}
