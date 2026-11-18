/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  clearMocks: true,
  restoreMocks: true,
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  // The integration tests run bin/runestone against dist/; build it once, before
  // the workers start, instead of once per test file in parallel.
  globalSetup: '<rootDir>/tests/helpers/build-cli.js'
};
