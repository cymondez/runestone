# Acceptance Matrix

| DESIGNE.md Area | Requirement | Evidence | Result |
| --- | --- | --- | --- |
| Project positioning | npm global CLI named `@developers-homelab/runestone-cli` | `package.json` name, bin entry, Node engine | Pass |
| Runtime | TypeScript compiled to CommonJS JavaScript | `tsconfig.json`, build pass, `bin/runestone` loads `dist/cli.js` | Pass |
| No Make dependency | Node calls Docker CLI directly, no Makefile port | Source scan in `design-acceptance.test.ts`; no Makefile references | Pass |
| Setup wizard | setup uses `@clack/prompts` | `src/commands/setup.ts`; acceptance test | Pass |
| Certificates | certs use `@mkcert/node`, not mkcert CLI | `src/commands/certs.ts`; acceptance test | Pass, live CA install not run |
| Cross-platform Docker calls | Use `spawnSync` with argument arrays and avoid shell-sensitive payloads | service tests plus execution test on Windows fake Docker | Pass |
| Command tree | `setup`, `up`, `stop`, `down`, `status`, `certs`, `keys` | Commander introspection and CLI help tests | Pass |
| Aliases | `cert`, `certs rm`, `cert del`, `keys list/ls` | Commander introspection and execution test for `cert del` | Pass |
| Env loading | CLI env path, cwd `.env`, project env, defaults | `env-loader.test.ts` | Pass |
| Lifecycle flow | up creates network/volume, compose up, injects keys | actual CLI process execution with fake Docker plus live Docker Compose startup using `cymondez/runstone:5.2`; WSL/Linux default-port startup passed | Pass |
| Stop/down/status | stop/down/status route to service layer and output status | unit tests plus actual CLI execution with fake Docker | Pass |
| SSH keys | scan home, add key, list injected keys | unit tests plus actual CLI execution with fake Docker | Pass |
| Tests | Unit and integration tests exist and pass | Jest results: 5 unit suites, 3 integration suites; live Docker Compose acceptance passed | Pass |
| Future commands | update/upgrade/rollback/doctor/logs/exec/project add are future directions | Not part of current command tree | Not required |
| Docs/package extras | README is listed in DESIGNE.md structure | No README added in this acceptance pass | Partial, non-functional gap |

## Ambiguities Resolved

- DESIGNE.md explicitly says setup must use `@clack/prompts`, despite an example mentioning `enquirer`; acceptance follows the explicit `@clack/prompts` requirement.
- DESIGNE.md mentions both `compose.yaml` and `compose.yml`; implementation uses `compose.yml`, matching the shown directory and existing generated resource shape.
