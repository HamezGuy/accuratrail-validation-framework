import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OQ_CASE_IDS, OQ_NOT_AUTOMATED, OQ_SUITES } from '../config/oq-case-registry';
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
  assert.equal(OQ_CASE_IDS.length, 205);
  assert.deepEqual([OQ_CASE_IDS[0], OQ_CASE_IDS[204]], ['OQ-001', 'OQ-205']);
  const directory = workspace(t);
  generateOqProtocol(directory, directory);
  const protocol = fs.readFileSync(path.join(directory, '08-oq-protocol.md'), 'utf8');
  const listed = [...protocol.matchAll(/^### (OQ-\d{3}):|^\| (OQ-\d{3}) \|/gm)].map(match => match[1] ?? match[2]);
  assert.deepEqual(listed, [...OQ_CASE_IDS]);
  assert.match(protocol, /\*\*Total test cases:\*\* 205 \(OQ-001 to OQ-205\)/);
  for (const suite of OQ_SUITES) assert.ok(protocol.includes(`## ${suite.title}`), suite.title);
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
