# Verification Result

Automated checks:
- TypeScript build passed.
- Jest passed: 9 test suites, 35 tests.

Live Windows checks:
- `runestone up --project C:\Users\cymondez\.runestone` passed and started container `runestone` using `cymondez/runstone:5.2`.
- `runestone cert --project C:\Users\cymondez\.runestone create acceptance-20260615.docker.so` passed.
- Generated files existed: `.crt`, `.key`, dynamic `.ssl.yml`, `rootCA.crt`, `rootCA.key`.
- X509 SAN was `DNS:*.acceptance-20260615.docker.so`.
- Docker container restarted after create.
- `runestone cert --project C:\Users\cymondez\.runestone remove acceptance-20260615.docker.so` passed.
- Generated cert and dynamic config files were absent afterward.
- Docker container restarted after remove.
