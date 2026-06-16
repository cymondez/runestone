Packet ID: tests
Status: completed

Changes:
- Integration execution test no longer calls `runestone up --project`.
- Test HOME/USERPROFILE points to a temporary home containing `.runestone/.env`, matching the setup-created location model.
- Design acceptance asserts `up` has no `--project`.
- CLI integration asserts `up --help` omits `--project` and `up --project somewhere` is rejected.
- Setup prompt acceptance asserts explanation text appears before the corresponding prompt in source order.
