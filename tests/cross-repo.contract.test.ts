import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaultPlatformRoot, defaultWorkspaceRoot, resolveFrontendRoot, resolveLibreclinicaApiRoot } from '../collectors/workspace-paths';
import { buildPlatformSummary } from '../generators/22-platform-validation-summary';
import { SYSTEM_INFO } from '../config/system-info';
import { TA3_INSPECTION_COVERAGE } from '../config/ta3-inspection-coverage';
import { checkDeadSettings, checkSoftwareInstallation, checkVendoredReceipts, declaredMajor, SHARED_TYPES_VERIFIER } from '../runners/iq-runner';
import { EDC_SIGNATURE_MEANINGS, ta3LedgerProblems, TA3_LEDGER_REQUIRED } from '../runners/oq-ta3-runner';
import { DEVIATION_MACHINE_CLASSES, DEVIATION_RECONSTRUCTION_ENTRY } from '../config/ta3-pq-cases';

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

// The TA3 OQ suites against the EDC checkout (VAL-1/validation-oq, spec P20 4.5). The W-1 and M-2
// blocks fail by name until those items land, so the coordinator sees what is missing.

/** The tables the EDC's src creates (CREATE TABLE, with or without IF NOT EXISTS), read with git grep over tracked files. */
function edcCreatedTables(edc: string): Set<string> {
  const found = spawnSync('git', ['-C', edc, 'grep', '-h', '-o', '-i', '-E', 'CREATE TABLE (IF NOT EXISTS )?"?[a-z_.]*acc_[a-z0-9_]+', '--', 'src'], { encoding: 'utf8' });
  assert.equal(found.error, undefined, `git grep could not read ${edc}`);
  assert.ok(found.status === 0 || found.status === 1, `git grep failed in ${edc}: ${found.stderr}`);
  return new Set([...found.stdout.matchAll(/(acc_[a-z0-9_]+)/g)].map(match => match[1]));
}

test('every non-late table of the TA3 inspection coverage list is created by the EDC at the sibling head', () => {
  const edc = resolveLibreclinicaApiRoot(defaultWorkspaceRoot());
  sibling(path.join(edc, 'package.json'));
  const created = edcCreatedTables(edc);
  const missing = TA3_INSPECTION_COVERAGE.filter(entry => !entry.late && !created.has(entry.table)).map(entry => entry.table);
  assert.deepEqual(missing, [], `no CREATE TABLE in ${edc}/src for ${missing.join(', ')}`);
});

test('W-1: the coverage list is, in order, the EDC\'s INSPECTION_STORES tables declared ta3: true', () => {
  const edc = resolveLibreclinicaApiRoot(defaultWorkspaceRoot());
  const exportService = path.join(edc, 'src', 'services', 'database', 'fda-inspection-export.service.ts');
  const text = sibling(exportService).toString('utf8');
  assert.match(text, /\bta3\s*:\s*true\b/, `W-1 not landed: ${exportService} declares no INSPECTION_STORES table with ta3: true (spec P17 2.2.1)`);
  // Declarations of the form {table:'<name>', ..., ta3: true} (P17 2.2.2); a new form must update this reader.
  const declared = [...text.matchAll(/table\s*:\s*'([a-z0-9_]+)'[^{}]*?\bta3\s*:\s*true/g)].map(match => match[1]);
  const core = TA3_INSPECTION_COVERAGE.filter(entry => !entry.late).map(entry => entry.table);
  assert.deepEqual(declared.slice(0, core.length), core, `${exportService}: the first ${core.length} ta3 declarations differ from config/ta3-inspection-coverage.ts`);
  const late = TA3_INSPECTION_COVERAGE.filter(entry => entry.late).map(entry => entry.table);
  assert.deepEqual(declared.slice(core.length).filter(table => !late.includes(table)), [], 'every late table the EDC declares is in the coverage list');
  const segmented = [...text.matchAll(/table\s*:\s*'([a-z0-9_]+)'[^{}]*?\bsegmentedOnly\s*:\s*true/g)].map(match => match[1]);
  assert.deepEqual(segmented, TA3_INSPECTION_COVERAGE.filter(entry => entry.segmentedOnly).map(entry => entry.table));
});

test('M-2: edc-ta3-ledger/1 requires the members OQ-237 checks, and the EDC\'s synthetic ledger passes those checks', () => {
  const edc = resolveLibreclinicaApiRoot(defaultWorkspaceRoot());
  const schemaFile = path.join(edc, 'src', 'services', 'data-factory', 'contracts', 'edc-ta3-ledger-v1.schema.json');
  const fixtureFile = path.join(edc, 'tests', 'fixtures', 'ta3-ledger', 'edc-ta3-ledger-v1.synthetic.json');
  assert.ok(fs.existsSync(schemaFile), `M-2 not landed: ${schemaFile} is missing`);
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  assert.deepEqual([...schema.required].sort(), [...TA3_LEDGER_REQUIRED].sort(), `${schemaFile} requires other top-level members than runners/oq-ta3-runner.ts checks`);
  assert.ok(fs.existsSync(fixtureFile), `M-2 not landed: ${fixtureFile} is missing`);
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  assert.deepEqual(ta3LedgerProblems(fixture, { required: schema.required, blinded: fixture.armGrouping === 'withheld' }), [], fixtureFile);
});

test('the signature meanings the TA3 cases expect are the EDC\'s own', () => {
  const edc = resolveLibreclinicaApiRoot(defaultWorkspaceRoot());
  const middleware = path.join(edc, 'src', 'middleware', 'part11.middleware.ts');
  const text = sibling(middleware).toString('utf8');
  for (const [name, meaning] of Object.entries(EDC_SIGNATURE_MEANINGS)) {
    const match = new RegExp(`export const ${name} = '([^']+)'`).exec(text);
    assert.ok(match, `${middleware} defines ${name}`);
    assert.equal(match[1], meaning, name);
  }
});

// The PQ tied to the O-7 run (VAL-1/validation-pq, spec P20 3.5 and 4.7). The O-7 block fails by name until
// O-7/cc lands its scorer and reconstruction entry; then the real-bytes import fixture of spec 4.7 is due.

test('the ten machine classes PQT-003 requires are, in order, the EDC\'s vendored DeviationLogic kinds', () => {
  const edc = resolveLibreclinicaApiRoot(defaultWorkspaceRoot());
  const typesFile = path.join(edc, 'src', 'services', 'deviation-engine', 'vendor', 'v2', 'shared-types', 'study-exchange-amendment', 'deviation', 'deviation-types.ts');
  const text = sibling(typesFile).toString('utf8');
  const start = text.indexOf('Machine logic'), end = text.indexOf('export type DeviationLogic');
  assert.ok(start >= 0 && end > start, `${typesFile} has no machine logic block before export type DeviationLogic`);
  const kinds = [...text.slice(start, end).matchAll(/readonly kind: '([a-z_]+)';/g)].map(match => match[1]);
  assert.deepEqual(kinds, [...DEVIATION_MACHINE_CLASSES], `${typesFile}: the machine logic kinds differ from config/ta3-pq-cases.ts`);
});

test('O-7: the CommandCenter checkout holds the deviation detection scorer and its reconstruction entry', () => {
  const cc = path.join(defaultPlatformRoot(), 'CommandCenter');
  sibling(path.join(cc, 'package.json'));
  for (const file of [DEVIATION_RECONSTRUCTION_ENTRY, 'synthetic-trial/surpass/deviations/score-detection.mjs']) {
    const full = path.join(cc, ...file.split('/'));
    assert.ok(fs.existsSync(full), `O-7 not landed: ${full} is missing (spec P09 8.3); a deviation detection import fails BENCHMARK-RECONSTRUCTION until it exists`);
  }
});

// The platform inventory against the sibling heads (VAL-1/validation-platform, spec P20 4.4). A statement that
// moved or a probe that stopped matching fails here and forces an update of config/platform-inventory.ts.

test('every platform repository resolves, and every statement literal and probe of the inventory is found at the sibling heads', () => {
  const summary = buildPlatformSummary(defaultWorkspaceRoot());
  assert.equal(summary.systems.length, 14, 'the summary lists the fourteen systems of the inventory');
  assert.equal(summary.platformRoot, defaultPlatformRoot());
  for (const system of summary.systems) {
    assert.ok(system.repo, `${system.id}: no repository found under ${summary.platformRoot}`);
    assert.match(system.head ?? '', /^[0-9a-f]{40}$/, `${system.id}: ${system.repo} is not its own git checkout`);
    if ('status' in system.statement) {
      assert.equal(system.statement.status, 'not-stated', `${system.id}: ${'detail' in system.statement ? system.statement.detail : ''}`);
    }
    for (const gap of system.gaps) {
      if (!gap.probe) continue;
      assert.equal(gap.probe.status, 'open', `${system.id} ${gap.id}: ${gap.probe.rule} ${JSON.stringify(gap.probe.literal)} in ${gap.probe.file} `
        + `is ${gap.probe.status}; update config/platform-inventory.ts`);
    }
  }
  const [change] = summary.pendingValidatedChanges;
  assert.ok('file' in change.category.sop, `the SOP-CC-001 category row: ${JSON.stringify(change.category.sop)}`);
  assert.deepEqual(change.flags.map(flag => [flag.flag, flag.value]),
    [['ENABLE_DEVIATION_ENGINE', false], ['ENABLE_DOMAIN_EVENTS', false], ['ENABLE_DEVIATION_DECISIONS', false]],
    'the EDC production profile keeps the D-04 settings off');
});
