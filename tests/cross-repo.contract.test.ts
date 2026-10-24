import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultWorkspaceRoot, resolveLibreclinicaApiRoot } from '../collectors/workspace-paths';

// Checks against sibling checkouts of the estate (npm run test:cross-repo). A
// missing sibling file fails the check and names its path; nothing is skipped.

const root = path.resolve(__dirname, '..');
const PACKAGE = '@accura-trial/shared-types';

function sibling(file: string): Buffer {
  assert.ok(fs.existsSync(file), `the cross-repo check needs ${file}, which is missing`);
  return fs.readFileSync(file);
}

test('the framework vendors the EDC API\'s shared-types build: the same selector, lock integrity, archive and receipt bytes', () => {
  const edc = resolveLibreclinicaApiRoot(defaultWorkspaceRoot());
  const edcSelector = JSON.parse(sibling(path.join(edc, 'package.json')).toString('utf8')).dependencies?.[PACKAGE];
  const selector = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies[PACKAGE];
  assert.equal(selector, edcSelector, `the EDC API at ${edc} pins ${edcSelector}`);
  const lockEntry = (lockfile: Buffer) => {
    const { version, resolved, integrity } = JSON.parse(lockfile.toString('utf8')).packages[`node_modules/${PACKAGE}`] ?? {};
    return { version, resolved, integrity };
  };
  assert.deepEqual(
    lockEntry(fs.readFileSync(path.join(root, 'package-lock.json'))),
    lockEntry(sibling(path.join(edc, 'package-lock.json'))),
  );
  const relative = selector.replace(/^file:/, '');
  for (const file of [relative, `${relative}.json`]) {
    assert.ok(sibling(path.join(edc, file)).equals(fs.readFileSync(path.join(root, file))), `${file} differs from the EDC API's copy`);
  }
});
