module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    // exclude integration specs — those run under jest.integration.config.js
    testPathIgnorePatterns: ['\\.integration\\.spec\\.ts$'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    },
}
