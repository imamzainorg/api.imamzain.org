module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/test'],
    testMatch: ['**/*.integration.spec.ts'],
    // Load .env.test before any test file is executed
    setupFiles: ['<rootDir>/test/load-env.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    },
    // DB queries can be slow; 30 s per test is generous but safe
    testTimeout: 30000,
}
