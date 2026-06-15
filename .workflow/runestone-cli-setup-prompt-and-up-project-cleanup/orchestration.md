Goal:
Fix two CLI contract issues: setup explanations must appear before prompts, and `runestone up` must not expose a spec-unrequested `--project` option.

Success criteria:
- Setup prints each setting explanation before asking for the value.
- Port explanations are printed before each port prompt.
- `runestone up --help` does not show `--project`.
- `runestone up --project ...` is no longer accepted by Commander.
- Tests cover the CLI contract and setup prompt ordering shape.

Current context:
- `setup.ts` currently uses `p.note` before prompts, but prompt rendering can make the note feel post-hoc.
- `up.ts` currently has an `UpOptions.project` field and `.option('--project ...')`.
- Integration tests currently use `runestone up --project` with a fake project.

Constraints:
- Do not add replacement hidden flags for testing.
- Do not change user files outside the requested CLI behavior.
- Keep changes scoped and verify with build/Jest.

Risks:
- Removing `--project` requires test setup to use the documented env path behavior instead.

Workflow artifact path:
`.workflow/runestone-cli-setup-prompt-and-up-project-cleanup`

Work packets:
- Discovery: inspect setup/up and tests.
- Implementation: reorder explanation rendering and remove `up --project`.
- Tests: update integration tests and add direct help/parse assertions.
- Verification: build, Jest, workflow verifier.
