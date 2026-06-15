# P1 Discovery

## Accepted

- `DESIGNE.md` is the implementation contract.
- Existing `dist/` provides a useful behavior snapshot but is ignored output, not source of truth.
- `@clack/prompts`, `@mkcert/node`, `commander`, `jest`, `ts-jest`, and TypeScript are already present in `node_modules`.
- `runestone-cli` lacks tracked `package.json`, `tsconfig.json`, source files, and tests.

## Decisions

- Use `@clack/prompts` for setup because the design explicitly requires it.
- Use `@mkcert/node` JavaScript API for certs; do not call mkcert CLI.
- Generate `~/.runestone/.env` and `~/.runestone/compose.yml` from setup/up resource helpers.
- Keep Docker invocation in service modules and test through mocks.
