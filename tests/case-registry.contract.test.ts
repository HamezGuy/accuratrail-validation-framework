import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  OQ_CASE_IDS, OQ_NOT_AUTOMATED, OQ_SUITES, TA3_OQ_SUITES, oqSuiteCaseIds, oqSuiteOf, parseOqSuiteSelection,
} from '../config/oq-case-registry';
import { TA3_ACCOUNTS, TA3_OQ_CASES, ta3RegulatoryRef } from '../config/ta3-oq-cases';
import { TA3_INSPECTION_COVERAGE } from '../config/ta3-inspection-coverage';
import { E6_R3_REFERENCES } from '../config/regulatory-scope';
import { TESTS_LIVE_MAPPINGS } from '../config/tests-live-mapping';
import { generate as generateOqProtocol } from '../generators/08-oq-protocol';
import { generate as generateTraceability } from '../generators/06-traceability-matrix';
import {
  generate as generateTrainingMatrix, retainTrainingInspectionEvidence, verifyTrainingInspectionEvidence,
} from '../generators/15-training-matrix';
import { defaultWorkspaceRoot, resolveTestsLiveRoot } from '../collectors/workspace-paths';

function workspace(t: { after(callback: () => void): void }): string {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'accura-case-registry-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('the OQ protocol lists exactly the registry cases the runner records', t => {
  // Suites 13 to 18 (OQ-206 to OQ-244) are appended after OQ-205 without renumbering.
  assert.equal(OQ_CASE_IDS.length, 244);
  assert.deepEqual([OQ_CASE_IDS[0], OQ_CASE_IDS[204], OQ_CASE_IDS[205], OQ_CASE_IDS[243]], ['OQ-001', 'OQ-205', 'OQ-206', 'OQ-244']);
  const directory = workspace(t);
  generateOqProtocol(directory, directory);
  const protocol = fs.readFileSync(path.join(directory, '08-oq-protocol.md'), 'utf8');
  const listed = [...protocol.matchAll(/^### (OQ-\d{3}):|^\| (OQ-\d{3}) \|/gm)].map(match => match[1] ?? match[2]);
  assert.deepEqual(listed, [...OQ_CASE_IDS]);
  assert.match(protocol, /\*\*Total test cases:\*\* 244 \(OQ-001 to OQ-244\)/);
  for (const suite of OQ_SUITES) assert.ok(protocol.includes(`## ${suite.title}`), suite.title);
  // The TA3 suites are detailed from the case catalog, with what each case needs and its ICH E6(R3) references.
  const detailed = [...protocol.matchAll(/^### (OQ-\d{3}):/gm)].map(match => match[1]);
  for (const suite of OQ_SUITES.filter(entry => TA3_OQ_SUITES.includes(entry.suite))) {
    for (const id of oqSuiteCaseIds(suite)) assert.ok(detailed.includes(id), `${id} has a detailed protocol block`);
  }
  const block = (id: string) => protocol.slice(protocol.indexOf(`### ${id}:`), protocol.indexOf('### ', protocol.indexOf(`### ${id}:`) + 4));
  assert.match(block('OQ-219'), /- \*\*Needs:\*\* O-1/);
  assert.match(block('OQ-237'), /- \*\*Needs:\*\* M-2/);
  assert.match(block('OQ-207'), /- \*\*ICH E6\(R3\):\*\* ICH E6\(R3\) Annex 1, 3\.12 Noncompliance/);
  assert.match(protocol, /dedicated duplicate armed synthetic study that a `ta3-oq-plan\/1` names/);
  for (const id of OQ_NOT_AUTOMATED) {
    const block = protocol.slice(protocol.indexOf(`### ${id}:`), protocol.indexOf('### ', protocol.indexOf(`### ${id}:`) + 4));
    assert.match(block, /Not executed by the automated OQ runner/);
  }

  const runner = fs.readFileSync(path.join(__dirname, '..', 'runners', 'oq-runner.ts'), 'utf8');
  assert.doesNotMatch(runner, /id <= 205/);
  assert.match(runner, /for \(const testCaseId of OQ_CASE_IDS\)/);
  const registry = new Set(OQ_CASE_IDS);
  const runnerIds = new Set([...runner.matchAll(/'(OQ-\d{3})'/g)].map(match => match[1]));
  assert.deepEqual([...runnerIds].filter(id => !registry.has(id)), []);
});

test('the TA3 case catalog holds exactly suites 13 to 18 in registry order, each with its references', () => {
  const ta3 = OQ_SUITES.filter(suite => TA3_OQ_SUITES.includes(suite.suite));
  assert.deepEqual(ta3.map(suite => [suite.suite, suite.first, suite.last]),
    [[13, 206, 214], [14, 215, 218], [15, 219, 226], [16, 227, 231], [17, 232, 238], [18, 239, 244]]);
  assert.deepEqual(TA3_OQ_CASES.map(entry => entry.id), ta3.flatMap(oqSuiteCaseIds));
  for (const entry of TA3_OQ_CASES) {
    assert.equal(oqSuiteOf(entry.id)?.suite, entry.suite, entry.id);
    assert.match(entry.requirement, /^URS-(08[1-9]|09[0-9]|10[01])$/, entry.id);
    assert.ok(entry.e6r3.length > 0 && entry.e6r3.every(key => key in E6_R3_REFERENCES), entry.id);
    assert.ok(entry.accounts.length > 0 && entry.accounts.every(account => TA3_ACCOUNTS.includes(account)), entry.id);
    assert.ok(entry.steps.length > 0 && entry.title && entry.expectedResult && entry.needs, entry.id);
    assert.match(ta3RegulatoryRef(entry), /^§11\.\d+(\([a-z]\))?(, §11\.\d+(\([a-z]\))?)*; ICH E6\(R3\) /, entry.id);
    // No em or en dash in text the protocol prints.
    assert.doesNotMatch(JSON.stringify(entry), /[–—]/, entry.id);
  }
});

test('--oq-suites selects the base suites 1 to 12 together and any TA3 suites', () => {
  assert.deepEqual(parseOqSuiteSelection('13-18'), { base: false, ta3: [13, 14, 15, 16, 17, 18] });
  assert.deepEqual(parseOqSuiteSelection('1-12, 15'), { base: true, ta3: [15] });
  assert.deepEqual(parseOqSuiteSelection('16,13'), { base: false, ta3: [13, 16] });
  assert.deepEqual(parseOqSuiteSelection('1-18'), { base: true, ta3: [13, 14, 15, 16, 17, 18] });
  assert.throws(() => parseOqSuiteSelection('1-5'), /suites 1 to 12 together or not at all/);
  assert.throws(() => parseOqSuiteSelection('19'), /names suite 19/);
  assert.throws(() => parseOqSuiteSelection('18-13'), /is reversed/);
  assert.throws(() => parseOqSuiteSelection(''), /takes suite numbers and ranges/);
  assert.throws(() => parseOqSuiteSelection('13;14'), /takes suite numbers and ranges/);
});

test('the TA3 inspection coverage list is W-1\'s: 39 tables in order, two segmented only, then the late block with owners', () => {
  const core = TA3_INSPECTION_COVERAGE.filter(entry => !entry.late);
  assert.equal(core.length, 39);
  assert.deepEqual(core.filter(entry => entry.segmentedOnly).map(entry => entry.table), ['acc_deviation_evaluations', 'acc_deviation_evidence_blobs']);
  assert.deepEqual([core.indexOf(core.find(entry => entry.table === 'acc_deviation_evaluations')!), core.length - 1], [16, 38]);
  const late = TA3_INSPECTION_COVERAGE.filter(entry => entry.late);
  assert.deepEqual(TA3_INSPECTION_COVERAGE.slice(39), late, 'the late block follows the 39');
  assert.deepEqual([...new Set(late.map(entry => entry.late!.item))], ['C-3', 'O-2', 'U-2', 'H-1', 'I-2', 'F-2', 'N-6', 'MR-1', 'MR-3']);
  assert.equal(new Set(TA3_INSPECTION_COVERAGE.map(entry => entry.table)).size, TA3_INSPECTION_COVERAGE.length);
  assert.ok(TA3_INSPECTION_COVERAGE.every(entry => /^acc_[a-z0-9_]+$/.test(entry.table) && !(entry.late && entry.segmentedOnly)));
});

const row = (value: unknown) => {
  const nativeJson = JSON.stringify(value);
  return { nativeJson, sha256: createHash('sha256').update(nativeJson).digest('hex') };
};
const table = (name: string, rows: unknown[]) => ({ table: name, count: rows.length, contentHash: 'module-hash', rows: rows.map(row) });

function capture() {
  return {
    schemaVersion: 'training-inspection-evidence/1', nonce: 'n', nativeStudyId: 7, actorUserId: 1, studyIds: [7],
    scopes: [{ studyId: 7 }], capturedAt: '2026-10-21T10:00:00.000Z', observedAt: '2026-10-21T10:00:01.000Z',
    consistency: 'training-snapshot-with-separate-native-observations', authorityHash: 'a'.repeat(64), complete: true,
    tables: [
      table('acc_training_courses', [
        { id: 1, course_code: 'GCP-101', course_name: 'Synthetic GCP', version: '2.0', passing_score: 80,
          required_for_roles: ['coordinator', 'investigator'], regulatory_reference: '21 CFR 11.10(i)', active: true, validity_period_days: 365 },
        { id: 2, course_code: 'ESIG-1', course_name: 'Synthetic signatures', version: '1.0', passing_score: 90,
          required_for_roles: ['investigator'], regulatory_reference: null, active: true, validity_period_days: null },
      ]),
      table('acc_training_obligations', [
        { id: 10, user_id: 100, course_id: 1, role: 'coordinator', status: 'assigned', due_at: '2026-10-01T00:00:00Z' },
        { id: 11, user_id: 101, course_id: 1, role: 'coordinator', status: 'assigned', due_at: '2026-12-01T00:00:00Z' },
        { id: 12, user_id: 102, course_id: 2, role: 'investigator', status: 'assigned', due_at: '2026-10-01T00:00:00Z' },
        { id: 13, user_id: 103, course_id: 2, role: 'investigator', status: 'withdrawn', due_at: '2026-10-01T00:00:00Z' },
      ]),
      table('acc_training_records', [
        { id: 20, user_id: 100, course_id: 1, status: 'completed', verified_at: '2026-10-02T00:00:00Z' },
        { id: 21, user_id: 101, course_id: 1, status: 'completed', verified_at: null },
        { id: 22, user_id: 102, course_id: 2, status: 'in_progress', verified_at: null },
      ]),
    ],
    materialSources: [], sourceChecks: [], impactSources: [], impactChecks: [], originalPins: [],
    gaps: ['Synthetic gap'], limitations: [], evidenceHash: 'e'.repeat(64),
  };
}

test('without a training capture the matrix states that nothing is shown instead of a fixed table', t => {
  const directory = workspace(t);
  generateTrainingMatrix(directory, directory);
  const matrix = fs.readFileSync(path.join(directory, '15-training-matrix.md'), 'utf8');
  assert.match(matrix, /No `training-inspection-evidence\/1` capture was supplied/);
  assert.doesNotMatch(matrix, /Developer \/ Maintainer|HIPAA Workforce|\| Required \|/);
});

test('the training matrix renders requirements and status from the training module capture', t => {
  const directory = workspace(t);
  const source = path.join(directory, 'capture.json');
  fs.writeFileSync(source, JSON.stringify(capture()));
  retainTrainingInspectionEvidence(source, directory);
  generateTrainingMatrix(directory, directory);
  const matrix = fs.readFileSync(path.join(directory, '15-training-matrix.md'), 'utf8');
  assert.match(matrix, /\| \*\*coordinator\*\* \| Not required \| Required \|/);
  assert.match(matrix, /\| \*\*investigator\*\* \| Required \| Required \|/);
  assert.match(matrix, /\| coordinator \| GCP-101 \| 2 \| 2 \| 1 \| 0 \|/);
  assert.match(matrix, /\| investigator \| ESIG-1 \| 1 \| 0 \| 0 \| 1 \|/);
  assert.match(matrix, /\| investigator \| GCP-101 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.match(matrix, /Evidence hash \(training module\) \| e{64}/);
  assert.match(matrix, /Gaps reported by the training module:\*\* Synthetic gap/);

  const tampered = capture();
  tampered.tables[0].rows[0].nativeJson = tampered.tables[0].rows[0].nativeJson.replace('GCP-101', 'GCP-999');
  assert.throws(() => verifyTrainingInspectionEvidence(JSON.stringify(tampered), 'tampered'), /differs from its SHA-256/);
  assert.throws(() => verifyTrainingInspectionEvidence(JSON.stringify({ ...capture(), complete: false }), 'partial'), /not a complete/);
});

test('the tests-live mapping is read into the traceability matrix and names existing scripts', t => {
  const directory = workspace(t);
  const testsLive = resolveTestsLiveRoot(defaultWorkspaceRoot());
  generateTraceability(directory, defaultWorkspaceRoot());
  const trace = fs.readFileSync(path.join(directory, '06-traceability-matrix.md'), 'utf8');
  assert.match(trace, /## Live Workflow Script Coverage/);
  assert.match(trace, /they are not execution evidence/);
  for (const mapping of TESTS_LIVE_MAPPINGS) assert.ok(trace.includes(mapping.scriptPath), mapping.scriptPath);
  if (testsLive) {
    assert.doesNotMatch(trace, /\(missing\)/);
    for (const mapping of TESTS_LIVE_MAPPINGS) assert.ok(fs.existsSync(path.join(testsLive, mapping.scriptPath)), mapping.scriptPath);
  }
});
