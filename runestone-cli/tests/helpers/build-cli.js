/**
 * Jest globalSetup: compiles `dist/` once, before any test worker starts.
 *
 * The integration tests run the real `bin/runestone`, which loads `dist/`. Each
 * of them used to run tsc in its own `beforeAll`, and Jest runs test files in
 * parallel workers, so one file's tsc could rewrite `dist/` while the other
 * file's CLI was loading it. Building here, once, removes that race. One build
 * takes about a second and a half.
 */
const { spawnSync } = require('child_process');
const path = require('path');

module.exports = async function buildCli() {
  const root = path.resolve(__dirname, '..', '..');
  const build = spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', 'tsconfig.json'], {
    cwd: root,
    encoding: 'utf8'
  });

  if (build.status !== 0) {
    throw new Error(build.stderr || build.stdout || 'tsc failed');
  }
};
