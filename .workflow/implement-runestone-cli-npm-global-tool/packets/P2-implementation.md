Packet ID: P2

Objective: Implement the npm global CLI tool.

Context: The tool must be TypeScript/CommonJS, expose `runestone`, and isolate Docker CLI calls behind services.

Files / sources: `runestone-cli/package.json`, `tsconfig.json`, `jest.config.js`, `src/**`, `.npmignore`, `bin/runestone`.

Ownership: CLI package and source files.

Do: Implement commands, services, env/path helpers, project file generation, setup with `@clack/prompts`, certs with `@mkcert/node`.

Do not: Execute real Docker commands as part of implementation.

Expected output: Buildable TypeScript source.

Verification: TypeScript build passed.
