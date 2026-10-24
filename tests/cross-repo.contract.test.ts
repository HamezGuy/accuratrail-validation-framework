import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultWorkspaceRoot, resolveFrontendRoot, resolveLibreclinicaApiRoot } from '../collectors/workspace-paths';
import { SYSTEM_INFO } from '../config/system-info';
import { checkDeadSettings, checkSoftwareInstallation, checkVendoredReceipts, declaredMajor, SHARED_TYPES_VERIFIER } from '../runners/iq-runner';

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

test('on the real trees IQ-005, IQ-006 and IQ-008 pass for the API, the UI and the framework, with the EDC verifier', () => {
  const workspace = defaultWorkspaceRoot();
  const edc = resolveLibreclinicaApiRoot(workspace);
  const ui = resolveFrontendRoot(workspace);
  const verifierFile = path.join(edc, SHARED_TYPES_VERIFIER);
  sibling(verifierFile);
  assert.equal(typeof require(verifierFile).verifyPinnedStudyContract, 'function', `${verifierFile} exports verifyPinnedStudyContract`);
  const angular = JSON.parse(sibling(path.join(ui, 'package.json')).toString('utf8')).dependencies?.['@angular/core'];
  assert.equal(String(declaredMajor(angular ?? '')), SYSTEM_INFO.architecture.frontend.version,
    `config/system-info.ts states the Angular major ${ui}/package.json declares (${angular})`);
  const results = checkSoftwareInstallation(workspace, edc);
  for (const id of ['IQ-005', 'IQ-006', 'IQ-008']) {
    const result = results.find(entry => entry.testCaseId === id);
    assert.ok(result?.passed, `${id}: ${result?.notes ?? 'not recorded'}`);
  }
  const consumers = (results.find(entry => entry.testCaseId === 'IQ-008')!.responseBody as { consumers: Array<{ name: string; root: string; verified: boolean }> }).consumers;
  assert.deepEqual(consumers.map(entry => [entry.name, entry.root, entry.verified]),
    [['api', edc, true], ['ui', ui, true], ['validation-framework', root, true]]);
});

test('on the real trees IQ-034 lists the dead production settings of map/repo-runtime.md 5.4 and IQ-035 names the interop archive', () => {
  // These are open defects of the EDC (RT-20, F17-09); when the EDC fixes one, update this block.
  const workspace = defaultWorkspaceRoot();
  const edc = resolveLibreclinicaApiRoot(workspace);
  sibling(path.join(edc, '.env.production.example'));
  sibling(path.join(resolveFrontendRoot(workspace), 'docker-compose.production.yml'));
  const dead = checkDeadSettings(edc, resolveFrontendRoot(workspace), workspace);
  assert.equal(dead.passed, false, dead.notes);
  const keys = (dead.responseBody as { deadKeys: Array<{ key: string }> }).deadKeys.map(entry => entry.key);
  for (const key of ['STRICT_VALIDATION_RULE_SIGNATURES', 'BACKUP_ENABLED', 'BACKUP_SCHEDULE', 'BACKUP_RETENTION_DAYS', 'BACKUP_S3_BUCKET']) {
    assert.ok(keys.includes(key), `IQ-034 lists ${key}: ${dead.notes}`);
  }
  const receipts = checkVendoredReceipts(edc);
  assert.equal(receipts.passed, false, receipts.notes);
  assert.match(receipts.notes, /@accura-trial\/interop-middleware: no receipt .*accura-trial-interop-middleware-0\.3\.0\.[0-9a-f]{16}\.tgz\.json/);
});
