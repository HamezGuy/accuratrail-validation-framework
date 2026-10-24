import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { derivePqtResults, importBenchmarkEvidence, summaryContractOf, type PqtDerivationInput } from '../runners/benchmark-evidence';
import { loadEvidence, setEvidenceMarking, type EvidenceResult } from '../runners/evidence-capture';
import { benchmarkRunInputs, createPackage, sealPackage, verifyPackage, SYNTHETIC_ROOT_MARKER } from '../runners/evidence-package';
import { loadRunnerEvidence, mappedCaseState, RUNNER_CASE_CHECKS } from '../generators/helpers/evidence-linker';
import { recordedPqRelease } from '../generators/22-platform-validation-summary';
import {
  BENCHMARK_RECONSTRUCTION_ENTRY, DEVIATION_DETECTION_CONTRACT, DEVIATION_MACHINE_CLASSES, DEVIATION_RECONSTRUCTION_ENTRY,
  RELEASE_PQ_CASE, TA3_PQ_CASES, UNSUPPORTED_DEVIATION_SUMMARY,
} from '../config/ta3-pq-cases';
import { temporaryDirectory } from './generated-documents';

/** PQ tied to the O-7 run (TA3 plan VAL-1, spec P20 3.5 and 4.7): PQT-001 to PQT-006 from a synthetic deviation
 * detection summary. Until O-7/cc lands the CommandCenter entry is a test stub in a temporary root; it re-scores
 * nothing, so these tests check the import's dispatch and derivation, not CommandCenter's reconstruction. */

const FIXTURE = path.join(__dirname, 'fixtures', 'deviation-detection-summary.synthetic.json');
const API = '0123456789abcdef0123456789abcdef01234567';
const PQT_IDS = TA3_PQ_CASES.map(entry => entry.id);
// An en or em dash, written as escapes so that this file holds neither.
const DASH = /[\u2013\u2014]/;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** A temporary CommandCenter root holding only a stub of the deviation entry, which records its arguments. */
function fakeCommandCenter(dir: string, mode: 'ok' | 'refuse' = 'ok'): string {
  const root = path.join(dir, `command-center-${mode}`);
  const entry = path.join(root, ...DEVIATION_RECONSTRUCTION_ENTRY.split('/'));
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, [
    `// TEST STUB, not CommandCenter code: it stands in for ${DEVIATION_RECONSTRUCTION_ENTRY} until O-7/cc lands.`,
    '// It re-scores nothing; it records its arguments and prints what the import reads.',
    "import fs from 'node:fs';",
    'const argv = process.argv.slice(1);',
    "fs.appendFileSync(new URL('./invocations.jsonl', import.meta.url), JSON.stringify(argv) + '\\n');",
    mode === 'refuse'
      ? "process.stderr.write('RECONSTRUCTION_MISMATCH from the test stub'); process.exit(1);"
      : "process.stdout.write(JSON.stringify({ ok: true, dir: argv[argv.indexOf('--dir') + 1], rescored: 'compared', stub: true }) + '\\n');",
    '',
  ].join('\n'));
  return root;
}

function invocations(root: string): string[][] {
  const file = path.join(root, ...DEVIATION_RECONSTRUCTION_ENTRY.split('/').slice(0, -1), 'invocations.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
}

const fixtureSummary = (): any => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** A synthetic deviation detection run: the fixture summary bound to the metrics written beside it. */
function deviationRun(dir: string, mutate: (summary: any) => void = () => {}, name = 'run'): string {
  const runDir = path.join(dir, name);
  fs.mkdirSync(runDir, { recursive: true });
  const metrics = Buffer.from(`${JSON.stringify({ label: 'SYNTHETIC ENGINEERING EVIDENCE (test metrics)', rows: [] }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, 'metrics.json'), metrics);
  const summary = fixtureSummary();
  summary.artifacts = { 'metrics.json': `sha256:${sha256(metrics)}` };
  mutate(summary);
  fs.writeFileSync(path.join(runDir, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return runDir;
}

/** The pure derivation over a mutated fixture summary. */
function derive(mutate: (summary: any) => void = () => {}): EvidenceResult[] {
  const summary = fixtureSummary();
  mutate(summary);
  return derivePqtResults({ runDir: '/synthetic/run', timestamp: '2026-10-24T00:00:00.000Z', summary, summarySha256: 'a'.repeat(64), metricsSha256: 'b'.repeat(64) });
}
const pqt = (results: EvidenceResult[], id: string) => results.find(result => result.testCaseId === id)!;

test('a deviation detection summary selects the deviation entry and records the two benchmark rows, then PQT-001 to PQT-006', async t => {
  const dir = temporaryDirectory(t, 'accura-pqt-'), cc = fakeCommandCenter(dir), runDir = deviationRun(dir);
  const output = path.join(dir, 'qualification');
  const results = await importBenchmarkEvidence(output, { runDir, commandCenterRoot: cc });
  assert.deepEqual(results.map(result => result.testCaseId), ['BENCHMARK-RECONSTRUCTION', 'BENCHMARK-ENGINEERING-GATES', ...PQT_IDS]);
  assert.deepEqual(results.map(result => result.passed), [true, true, true, true, true, true, true, false], JSON.stringify(results.map(r => r.notes)));
  assert.deepEqual(invocations(cc), [[path.join(cc, ...DEVIATION_RECONSTRUCTION_ENTRY.split('/')), '--dir', runDir]]);
  const attachment = results[0].responseBody as Record<string, unknown>;
  assert.equal(attachment.summaryContract, DEVIATION_DETECTION_CONTRACT);
  assert.equal(attachment.reconstructionEntry, DEVIATION_RECONSTRUCTION_ENTRY);
  for (const pqCase of TA3_PQ_CASES) {
    const row = pqt(results, pqCase.id);
    assert.equal(row.endpoint, runDir, pqCase.id);
    assert.equal(row.testDescription, pqCase.title, pqCase.id);
    assert.equal(row.acceptanceCriteria, pqCase.passesWhen, pqCase.id);
    assert.equal((row.responseBody as Record<string, unknown>).summarySha256, sha256(fs.readFileSync(path.join(runDir, 'run-summary.json'))), pqCase.id);
  }
  const manual = pqt(results, 'PQT-006');
  assert.equal(manual.method, 'MANUAL');
  assert.equal(manual.outcomeCode, undefined);
  assert.match(manual.notes, /^Manual verification required: a qualified person adjudicates/);
  assert.deepEqual((pqt(results, 'PQT-003').responseBody as any).ruleClasses.map((entry: any) => entry.class), [...DEVIATION_MACHINE_CLASSES]);
  assert.deepEqual(loadEvidence(output, 'benchmark'), results);
  const evidence = loadRunnerEvidence(output);
  assert.deepEqual(PQT_IDS.map(id => mappedCaseState(id, evidence)), ['passed', 'passed', 'passed', 'passed', 'passed', 'manual-pending']);
  // The platform summary (22) reads the release PQT-005 recorded from the retained per-case file.
  const releaseRecord = JSON.parse(fs.readFileSync(path.join(output, 'evidence', 'benchmark', `${RELEASE_PQ_CASE}.json`), 'utf8'));
  assert.deepEqual(recordedPqRelease(releaseRecord), { kind: 'git-commit', identity: API });
  assert.deepEqual(releaseRecord.responseBody.release, { api: API, training: '89abcdef0123456789abcdef0123456789abcdef',
    il: 'fedcba9876543210fedcba9876543210fedcba98', csl: 'csl-release-synthetic-0001' });
  await assert.rejects(importBenchmarkEvidence(output, { runDir, commandCenterRoot: cc }), /already exists/);
});

test('a run of any other contract keeps its entry and exactly its two rows', async t => {
  const dir = temporaryDirectory(t, 'accura-pqt-'), cc = fakeCommandCenter(dir);
  const runDir = deviationRun(dir, summary => { delete summary.contract; summary.schema = 'synthetic-trial.run-summary/3'; });
  const results = await importBenchmarkEvidence(path.join(dir, 'qualification'), { runDir, commandCenterRoot: cc });
  assert.deepEqual(results.map(result => [result.testCaseId, result.passed]), [['BENCHMARK-RECONSTRUCTION', false], ['BENCHMARK-ENGINEERING-GATES', false]]);
  // The fake root holds no benchmark evaluator: the import asked for it, by path, and never ran the deviation stub.
  assert.equal((results[0].responseBody as any).error, `Benchmark reconstruction entry not found: ${path.join(cc, ...BENCHMARK_RECONSTRUCTION_ENTRY.split('/'))}`);
  assert.equal((results[0].responseBody as any).summaryContract, undefined);
  assert.deepEqual(invocations(cc), []);
});

test('the summary contract is read from contract, schema or schemaVersion, and a conflicting one refuses the run', async t => {
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  for (const key of ['contract', 'schema', 'schemaVersion']) {
    assert.deepEqual(summaryContractOf(bytes({ [key]: DEVIATION_DETECTION_CONTRACT })), { contract: DEVIATION_DETECTION_CONTRACT }, key);
  }
  assert.deepEqual(summaryContractOf(bytes({ schema: 'synthetic-trial.run-summary/3' })), {});
  assert.deepEqual(summaryContractOf(Buffer.from('{not json')), {});
  assert.deepEqual(summaryContractOf(bytes([DEVIATION_DETECTION_CONTRACT])), {});
  assert.match(summaryContractOf(bytes({ contract: DEVIATION_DETECTION_CONTRACT, schema: 'synthetic-trial.run-summary/3' })).conflict!, /another contract in schema/);

  const dir = temporaryDirectory(t, 'accura-pqt-'), cc = fakeCommandCenter(dir);
  const runDir = deviationRun(dir, summary => { summary.schema = 'synthetic-trial.run-summary/3'; });
  const results = await importBenchmarkEvidence(path.join(dir, 'qualification'), { runDir, commandCenterRoot: cc });
  assert.deepEqual(results.map(result => result.testCaseId), ['BENCHMARK-RECONSTRUCTION', 'BENCHMARK-ENGINEERING-GATES', ...PQT_IDS]);
  assert.match((results[0].responseBody as any).error, /Unsupported deviation detection summary: run-summary\.json names another contract in schema/);
  assert.equal(pqt(results, 'PQT-001').outcomeCode, 'RECONSTRUCTION_FAILED');
  assert.deepEqual(invocations(cc), [], 'the entry is never spawned for a refused summary');
});

test('a missing deviation entry fails BENCHMARK-RECONSTRUCTION with its path named, and PQT-002 to PQT-005 are not executed', async t => {
  const dir = temporaryDirectory(t, 'accura-pqt-'), runDir = deviationRun(dir), empty = path.join(dir, 'command-center-empty');
  fs.mkdirSync(empty);
  const output = path.join(dir, 'qualification');
  const results = await importBenchmarkEvidence(output, { runDir, commandCenterRoot: empty });
  assert.equal(results.length, 8);
  assert.equal(results[0].passed, false);
  assert.equal((results[0].responseBody as any).error, `Benchmark reconstruction entry not found: ${path.join(empty, ...DEVIATION_RECONSTRUCTION_ENTRY.split('/'))}`);
  assert.equal((results[0].responseBody as any).summaryContract, DEVIATION_DETECTION_CONTRACT);
  const first = pqt(results, 'PQT-001');
  assert.deepEqual([first.passed, first.method, first.outcomeCode], [false, 'OFFLINE', 'RECONSTRUCTION_FAILED']);
  assert.match(first.notes, /reconstruct-detection\.mjs/);
  for (const id of ['PQT-002', 'PQT-003', 'PQT-004', 'PQT-005']) {
    const row = pqt(results, id);
    assert.deepEqual([row.passed, row.method, row.outcomeCode], [false, 'CONTRACT', 'RECONSTRUCTION_FAILED'], id);
  }
  assert.equal(pqt(results, 'PQT-006').method, 'MANUAL');
  const evidence = loadRunnerEvidence(output);
  assert.deepEqual(PQT_IDS.map(id => mappedCaseState(id, evidence)), ['failed', 'not-executed', 'not-executed', 'not-executed', 'not-executed', 'manual-pending']);
});

test('a metrics hash mismatch, a summary that binds no metrics, or a refusing entry fails the reconstruction', async t => {
  const dir = temporaryDirectory(t, 'accura-pqt-'), cc = fakeCommandCenter(dir), refusing = fakeCommandCenter(dir, 'refuse');
  const tampered = deviationRun(dir, () => {}, 'tampered');
  fs.appendFileSync(path.join(tampered, 'metrics.json'), ' ');
  const unbound = deviationRun(dir, summary => { delete summary.artifacts; }, 'unbound');
  const refused = deviationRun(dir, () => {}, 'refused');
  const cases: [string, string, string, RegExp][] = [
    ['tampered', tampered, cc, /metrics\.json does not match the SHA-256 run-summary\.json records for it/],
    ['unbound', unbound, cc, /records no SHA-256 of metrics\.json under artifacts/],
    ['refused', refused, refusing, /RECONSTRUCTION_MISMATCH from the test stub/],
  ];
  for (const [name, runDir, root, error] of cases) {
    const results = await importBenchmarkEvidence(path.join(dir, `qualification-${name}`), { runDir, commandCenterRoot: root });
    assert.equal(results.length, 8, name);
    assert.match((results[0].responseBody as any).error, error, name);
    assert.deepEqual(results.filter(result => result.passed).map(result => result.testCaseId), [], name);
    assert.equal(pqt(results, 'PQT-001').outcomeCode, 'RECONSTRUCTION_FAILED', name);
  }
});

test('PQT-005 passes only when the run states its EDC API release, and records it for the platform summary', () => {
  const image = `SHA256:${'C'.repeat(64)}`;
  const stated = pqt(derive(summary => { summary.release = { api: image }; }), 'PQT-005');
  assert.equal(stated.passed, true);
  assert.deepEqual((stated.responseBody as any).release, { api: `sha256:${'c'.repeat(64)}` });
  assert.deepEqual(recordedPqRelease(stated as unknown as Record<string, unknown>), { kind: 'image-id', identity: `sha256:${'c'.repeat(64)}` });
  for (const [name, mutate] of [
    ['no release', (summary: any) => { delete summary.release; }],
    ['a null release', (summary: any) => { summary.release = null; }],
    ['no EDC API release', (summary: any) => { delete summary.release.api; }],
  ] as const) {
    const row = pqt(derive(mutate), 'PQT-005');
    assert.deepEqual([row.passed, row.outcomeCode], [false, 'RELEASE_NOT_RECORDED'], name);
    assert.equal((row.responseBody as any).release, null, name);
    assert.equal(recordedPqRelease(row as unknown as Record<string, unknown>), null, name);
  }
});

const UNSUPPORTED_SHAPES: [string, string, (summary: any) => void][] = [
  ['an unknown member in a class entry', 'PQT-003', summary => { summary.ruleClasses[0].weight = 2; }],
  ['an unknown class', 'PQT-003', summary => { summary.ruleClasses[0].class = 'visit_windows'; }],
  ['a class listed twice', 'PQT-003', summary => { summary.ruleClasses.push(summary.ruleClasses[1]); }],
  ['rule classes that are not an array', 'PQT-003', summary => { summary.ruleClasses = {}; }],
  ['an unknown class status', 'PQT-003', summary => { summary.ruleClasses[0].status = 'skipped'; }],
  ['a recall interval that is not Wilson', 'PQT-003', summary => { summary.ruleClasses[0].recall.method = 'clopper-pearson'; }],
  ['a recall without its confidence', 'PQT-003', summary => { delete summary.ruleClasses[0].recall.confidence; }],
  ['a precision without its denominator', 'PQT-003', summary => { delete summary.ruleClasses[1].precision.governed; }],
  ['a count that is not an integer', 'PQT-003', summary => { summary.ruleClasses[1].seeded = '2'; }],
  ['an unknown critical miss code', 'PQT-003', summary => { summary.ruleClasses[0].criticalMisses[0].code = 'SOMETHING_ELSE'; }],
  ['a not-seedable class whose reason is not text', 'PQT-003', summary => { summary.ruleClasses[8].reason = 7; }],
  ['an unknown manualRules member', 'PQT-004', summary => { summary.manualRules.reviewers = 2; }],
  ['no manualRules', 'PQT-004', summary => { delete summary.manualRules; }],
  ['manual counts that are not integers', 'PQT-004', summary => { summary.manualRules.specRules = -1; }],
  ['no gate DEV-CRITICAL-EXPLAINED', 'PQT-002', summary => { summary.gateGroups[0].gates = []; }],
  ['the gate twice', 'PQT-002', summary => { summary.gateGroups[1].gates.push(summary.gateGroups[0].gates[0]); }],
  ['an unknown gate status', 'PQT-002', summary => { summary.gateGroups[0].gates[0].status = 'green'; }],
  ['a gate group without gates', 'PQT-002', summary => { delete summary.gateGroups[1].gates; }],
  ['an unknown release member', 'PQT-005', summary => { summary.release.edc = API; }],
  ['a release that is not an object', 'PQT-005', summary => { summary.release = API; }],
  ['an EDC API release that is no commit or image', 'PQT-005', summary => { summary.release.api = 'v1.2.3'; }],
  ['an IL release that is no commit', 'PQT-005', summary => { summary.release.il = 'main'; }],
  ['a CSL release id with a control character', 'PQT-005', summary => { summary.release.csl = 'csl\nrelease'; }],
];
for (const [name, id, mutate] of UNSUPPORTED_SHAPES) {
  test(`${name} gives ${id} UNSUPPORTED_DEVIATION_SUMMARY, never a guess, and leaves the other cases as they are`, () => {
    const results = derive(mutate);
    const row = pqt(results, id);
    assert.deepEqual([row.passed, row.method, row.outcomeCode], [false, 'OFFLINE', UNSUPPORTED_DEVIATION_SUMMARY], JSON.stringify(row.responseBody));
    assert.ok(((row.responseBody as any).problems as string[]).length > 0);
    for (const other of results.filter(result => result.testCaseId !== id && result.method !== 'MANUAL')) {
      assert.equal(other.passed, true, `${other.testCaseId}: ${other.notes}`);
    }
  });
}

const CLASS_GAPS: [string, (summary: any) => void, RegExp][] = [
  ['a machine class without an entry', summary => { summary.ruleClasses = summary.ruleClasses.filter((entry: any) => entry.class !== 'field_range'); }, /no entry for field_range/],
  ['a reported class that seeded nothing', summary => {
    Object.assign(summary.ruleClasses[1], { seeded: 0, detected: 0, recall: { value: null, lower: null, upper: null, method: 'wilson', confidence: 0.95 },
      precision: { matched: 0, governed: 0, value: null }, unmatched: 0 });
  }, /visit_order seeded no deviation/],
  ['a not-seedable class with an empty reason', summary => { summary.ruleClasses[8].reason = '  '; }, /consent_before_procedure is not-seedable without a reason/],
  ['a recall that is not detected over seeded', summary => { summary.ruleClasses[0].recall.value = 0.8; }, /visit_window recall 0\.8/],
  ['a recall outside its interval', summary => { summary.ruleClasses[4].recall.lower = 0.6; }, /numeric_threshold recall 0\.5 \[0\.6/],
  ['more detected than seeded', summary => { summary.ruleClasses[5].detected = 2; }, /prohibited_medication detected more seeds than it seeded/],
  ['a precision that is not matched over governed', summary => { summary.ruleClasses[2].precision.value = 1; }, /missed_visit precision 1 is not 3 of 4/],
  ['unmatched detections that are not governed minus matched', summary => { summary.ruleClasses[2].unmatched = 0; }, /missed_visit unmatched 0 is not 4 minus 3/],
];
for (const [name, mutate, problem] of CLASS_GAPS) {
  test(`${name} gives PQT-003 CLASS_NOT_REPORTED`, () => {
    const row = pqt(derive(mutate), 'PQT-003');
    assert.deepEqual([row.passed, row.outcomeCode], [false, 'CLASS_NOT_REPORTED']);
    assert.match(row.notes, problem);
  });
}

test('a scored manual rule gives PQT-004 MANUAL_RULE_SCORED, and an unexplained critical miss PQT-002 UNEXPLAINED_CRITICAL_MISS', () => {
  const scored = pqt(derive(summary => { summary.manualRules.recall = { value: 1, lower: 0.2, upper: 1, method: 'wilson', confidence: 0.95 }; }), 'PQT-004');
  assert.deepEqual([scored.passed, scored.outcomeCode], [false, 'MANUAL_RULE_SCORED']);
  assert.match(scored.notes, /manualRules\.recall/);
  const manualClass = derive(summary => { summary.ruleClasses.push({ class: 'manual', status: 'reported', seeded: 1, detected: 1 }); });
  assert.deepEqual([pqt(manualClass, 'PQT-004').passed, pqt(manualClass, 'PQT-004').outcomeCode], [false, 'MANUAL_RULE_SCORED']);
  assert.equal(pqt(manualClass, 'PQT-003').outcomeCode, UNSUPPORTED_DEVIATION_SUMMARY);
  for (const status of ['failed', 'blocked', 'not_run', 'not_applicable']) {
    const gate = pqt(derive(summary => { summary.gateGroups[0].gates[0].status = status; }), 'PQT-002');
    assert.deepEqual([gate.passed, gate.outcomeCode], [false, 'UNEXPLAINED_CRITICAL_MISS'], status);
    assert.equal((gate.responseBody as any).gate.status, status);
  }
});

test('derivePqtResults is pure: the same input gives the same rows and the input is not changed', () => {
  const input: PqtDerivationInput = { runDir: '/synthetic/run', timestamp: '2026-10-24T00:00:00.000Z', summary: fixtureSummary(),
    summarySha256: 'a'.repeat(64), metricsSha256: 'b'.repeat(64) };
  const before = JSON.stringify(input);
  assert.deepEqual(derivePqtResults(input), derivePqtResults(input));
  assert.equal(JSON.stringify(input), before);
  const failed = derivePqtResults({ ...input, summary: undefined, reconstructionError: 'synthetic failure' });
  assert.deepEqual(failed.map(row => [row.testCaseId, row.method, row.outcomeCode ?? null]), [
    ['PQT-001', 'OFFLINE', 'RECONSTRUCTION_FAILED'], ['PQT-002', 'CONTRACT', 'RECONSTRUCTION_FAILED'], ['PQT-003', 'CONTRACT', 'RECONSTRUCTION_FAILED'],
    ['PQT-004', 'CONTRACT', 'RECONSTRUCTION_FAILED'], ['PQT-005', 'CONTRACT', 'RECONSTRUCTION_FAILED'], ['PQT-006', 'MANUAL', null]]);
});

test('a retained package keeps the O-7 import, its eight rows and its inputs, and verifies', async t => {
  const dir = temporaryDirectory(t, 'accura-pqt-'), cc = fakeCommandCenter(dir), runDir = deviationRun(dir);
  fs.writeFileSync(path.join(dir, SYNTHETIC_ROOT_MARKER), 'Synthetic-trial data root for a contract test.\n');
  t.after(() => setEvidenceMarking(undefined));
  const evidencePackage = createPackage({ retainRoot: path.join(dir, 'runs', 'validation-packages'), version: 'pqt-v1',
    executed: true, syntheticBasis: ['benchmark-import'], inputs: benchmarkRunInputs(runDir) });
  const results = await importBenchmarkEvidence(evidencePackage.dir, { runDir, commandCenterRoot: cc });
  sealPackage(evidencePackage);
  const verified = verifyPackage(evidencePackage.dir);
  assert.deepEqual(verified.problems, []);
  assert.deepEqual(verified.manifest!.categories, [{ category: 'benchmark', total: 8, passed: 7, failed: 1, manual: 1, notExecuted: 0 }]);
  const attachment = results[0].responseBody as { summarySha256: string; metricsSha256: string };
  assert.deepEqual(verified.manifest!.inputs.map(input => [input.role, input.sha256]),
    [['benchmark-run-summary', attachment.summarySha256], ['benchmark-metrics', attachment.metricsSha256]]);
  for (const result of loadEvidence(evidencePackage.dir, 'benchmark')) assert.equal(result.synthetic, true, result.testCaseId);
  const record = JSON.parse(fs.readFileSync(path.join(evidencePackage.dir, 'evidence', 'benchmark', `${RELEASE_PQ_CASE}.json`), 'utf8'));
  assert.deepEqual(recordedPqRelease(record), { kind: 'git-commit', identity: API });
});

test('every PQT case has its catalogued check, PQT-006 alone manual, and no case text holds a dash', () => {
  assert.deepEqual(PQT_IDS, ['PQT-001', 'PQT-002', 'PQT-003', 'PQT-004', 'PQT-005', 'PQT-006']);
  for (const pqCase of TA3_PQ_CASES) {
    const check = RUNNER_CASE_CHECKS[pqCase.id];
    assert.ok(check, pqCase.id);
    assert.equal(check.manual === true, pqCase.method === 'MANUAL', pqCase.id);
    assert.equal(pqCase.failureCode === null, pqCase.method === 'MANUAL', pqCase.id);
    assert.doesNotMatch(check.check, DASH, pqCase.id);
  }
  assert.doesNotMatch(JSON.stringify(TA3_PQ_CASES), DASH);
  assert.doesNotMatch(JSON.stringify(derive()), DASH);
  assert.doesNotMatch(JSON.stringify(derivePqtResults({ runDir: '/r', timestamp: 't', reconstructionError: 'x', summarySha256: null, metricsSha256: null })), DASH);
  assert.equal(DEVIATION_MACHINE_CLASSES.length, 10);
});
