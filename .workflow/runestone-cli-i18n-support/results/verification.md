# Verification

Passed:
- TypeScript build with `node node_modules/typescript/bin/tsc --project tsconfig.json`.
- Jest with `node node_modules/jest/bin/jest.js --runInBand`.
- Jest result: 12 suites passed, 56 tests passed.
- Manual help smoke:
  - `RUNESTONE_LANG=en runestone up --help` shows English description.
  - `RUNESTONE_LANG=zh-TW runestone up --help` shows Traditional Chinese description.
  - `RUNESTONE_LANG=ja-JP runestone up --help` shows Japanese description.
