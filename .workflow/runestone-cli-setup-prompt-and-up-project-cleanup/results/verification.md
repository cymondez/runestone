# Verification

Passed:
- TypeScript build with `node node_modules/typescript/bin/tsc --project tsconfig.json`.
- Jest with `node node_modules/jest/bin/jest.js --runInBand`.
- Jest result: 10 suites passed, 42 tests passed.
- Manual CLI check: `runestone up --help` does not list `--project`.
- Manual CLI check: `runestone up --project somewhere` exits with `error: unknown option '--project'`.
