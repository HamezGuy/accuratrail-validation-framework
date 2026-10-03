import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadEvidence, saveEvidence, manualResult, captureWithExpectedStatus, captureWithValidator, type EvidenceResult,
} from '../runners/evidence-capture';
import { loadRunnerEvidence, tryLoadEvidence } from '../generators/helpers/evidence-linker';
import { generate as generateExecutionRecords } from '../generators/20-test-execution-records';
import { generate as generateUrs } from '../generators/03-user-requirements-spec';
import { generate as generateFrs } from '../generators/04-functional-requirements-spec';
import { generate as generateRiskAssessment } from '../generators/05-risk-assessment';
import { generate as generateTraceability } from '../generators/06-traceability-matrix';
import { generate as generateOqProtocol } from '../generators/08-oq-protocol';
import { generate as generateHipaa } from '../generators/14-hipaa-assessment';
import { generate as generateRegulatoryMap } from '../generators/18-regulatory-requirements-map';
import { generate as generateCsaAssurance } from '../generators/19-csa-feature-assurance';
import { generate as generateDesignSpec } from '../generators/21-design-specification';
import { SYSTEM_INFO } from '../config/system-info';
import { login, optionalQualificationCredentials, qualificationCredentials } from '../runners/auth';
import { pqCredentials, run as runPq } from '../runners/pq-runner';
import { run as runOq } from '../runners/oq-runner';
import { run as runPerformance } from '../runners/performance-runner';

function workspace(t: { after(callback: () => void): void }): string {
  const root = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(root, 'accura-evidence-contract-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function result(overrides: Partial<EvidenceResult> = {}): EvidenceResult {
  return {
    testCaseId: 'OQ-001', timestamp: '2026-09-21T00:00:00Z', endpoint: '/synthetic',
    method: 'GET', responseStatus: 200, responseBody: { zero: 0, empty: '', nil: null, no: false },
    passed: true, notes: 'Offline synthetic evidence', ...overrides,
  };
}

test('all evidence readers use the saved pass/fail records without losing metadata', t => {
  const directory = workspace(t);
  const records = [result(), result({ testCaseId: 'OQ-002', passed: false, notes: 'Synthetic failure' })];
  saveEvidence(directory, 'oq', records);
  assert.deepEqual(loadEvidence(directory, 'oq'), records);
  assert.deepEqual(tryLoadEvidence(directory, 'oq'), { total: 2, pass: 1, fail: 1 });
  assert.deepEqual(loadRunnerEvidence(directory).get('OQ-001'), records[0]);
  assert.deepEqual(tryLoadEvidence(directory, 'iq'), { total: 0, pass: 0, fail: 0 });
  generateExecutionRecords(directory, directory);
});

for (const [label, payload] of Object.entries({
  'malformed JSON': '{',
  'wrong envelope': '{}',
  'string verdict': JSON.stringify([result({ passed: 'false' as any })]),
  'missing verdict': JSON.stringify([{ testCaseId: 'OQ-001' }]),
  'duplicate result': JSON.stringify([result(), result()]),
})) {
  test(`every report refuses ${label} instead of reporting a pass or missing evidence`, t => {
    const directory = workspace(t), evidenceDir = path.join(directory, 'evidence', 'oq');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'oq-results.json'), payload);
    for (const read of [
      () => loadEvidence(directory, 'oq'),
      () => loadRunnerEvidence(directory),
      () => tryLoadEvidence(directory, 'oq'),
      () => generateExecutionRecords(directory, directory),
    ]) assert.throws(read, /Invalid evidence/);
  });
}

test('retention redacts credentials in every exchange without changing the live response or revision token', t => {
  const directory = workspace(t);
  const original = result({
    requestBody: { password: 'synthetic-password', signature: { signaturePassword: 'synthetic-signature' } },
    requestHeaders: { Authorization: 'Bearer synthetic-access', 'X-Request-ID': 'request-1' },
    responseHeaders: { 'set-cookie': 'synthetic-cookie', 'content-type': 'application/json' },
    responseBody: { accessToken: 'synthetic-access', revisionToken: 'revision-1', data: [{ refreshToken: 'synthetic-refresh', value: 0 }] },
    relatedEvidence: [result({ testCaseId: 'OQ-001-read', requestHeaders: { authorization: 'Bearer nested-access' } })],
  });
  saveEvidence(directory, 'oq', [original]);
  assert.equal((original.requestBody as any).password, 'synthetic-password');
  const saved = loadEvidence(directory, 'oq')[0];
  assert.equal((saved.responseBody as any).revisionToken, 'revision-1');
  assert.equal((saved.responseBody as any).data[0].value, 0);
  for (const file of fs.readdirSync(path.join(directory, 'evidence', 'oq'))) {
    const content = fs.readFileSync(path.join(directory, 'evidence', 'oq', file), 'utf8');
    for (const secret of ['synthetic-password', 'synthetic-signature', 'synthetic-access', 'synthetic-cookie', 'synthetic-refresh', 'nested-access']) {
      assert.equal(content.includes(secret), false, `${file} retained ${secret}`);
    }
  }
});

test('duplicate IDs and path-like IDs cannot overwrite evidence files', t => {
  const directory = workspace(t);
  assert.throws(() => saveEvidence(directory, 'oq', [result(), result()]), /duplicate/);
  assert.throws(() => saveEvidence(directory, 'oq', [result({ testCaseId: '../escape' })]), /malformed/);
  assert.throws(() => saveEvidence(directory, 'oq', [result({ method: 'MANUAL', passed: true })]), /manual/);
});

test('login rejects a successful HTTP response without a usable session token', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ accessToken: '' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  const outcome = await login('https://qualification.invalid', 'synthetic-user', 'synthetic-password');
  assert.equal(outcome.session, null);
  assert.equal(outcome.evidence.passed, false);
  assert.equal(JSON.stringify(outcome.evidence).includes('synthetic-password'), false);
});

test('login preserves nested principal metadata and never invents an organization', async t => {
  let payload: unknown = {
    success: true,
    data: { accessToken: 'synthetic-access', user: { userId: 17 }, organizations: [{ organizationId: 23 }] },
  };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  const authenticate = () => login('https://qualification.invalid', 'synthetic-user', 'synthetic-password');
  assert.deepEqual((await authenticate()).session, { token: 'synthetic-access', userId: 17, orgId: 23 });
  payload = { accessToken: 'synthetic-access' };
  assert.deepEqual((await authenticate()).session, { token: 'synthetic-access', userId: null, orgId: null });
  payload = { success: false, accessToken: 'synthetic-access' };
  const rejected = await authenticate();
  assert.equal(rejected.session, null);
  assert.equal(rejected.evidence.passed, false);
});

test('a successful status with an unreadable body remains failed evidence in every wrapper', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{broken', {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  const opts = { testCaseId: 'OQ-001', method: 'GET', url: '/synthetic', baseUrl: 'https://qualification.invalid' };
  const expected = await captureWithExpectedStatus(opts, 200);
  const validated = await captureWithValidator(opts, () => {
    assert.fail('A malformed response must not be reclassified by the validator');
  });
  for (const captured of [expected, validated]) {
    assert.equal(captured.responseStatus, 200);
    assert.equal(captured.passed, false);
    assert.equal(typeof captured.captureError, 'string');
    assert.match(captured.notes, /Request failed/);
  }
});

test('network and validator failures cannot become passing qualification records', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (): Promise<Response> => { throw new Error('offline network failure'); });
  const opts = { testCaseId: 'OQ-001', method: 'GET', url: '/synthetic', baseUrl: 'https://qualification.invalid' };
  assert.equal((await captureWithExpectedStatus(opts, 0)).passed, false);
  assert.equal((await captureWithValidator(opts, () => ({ passed: true, notes: 'must not run' }))).passed, false);
  fetchMock.mock.mockImplementation(async () => new Response('{}', {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  const invalid = await captureWithValidator(opts, () => { throw new Error('invalid response shape'); });
  assert.equal(invalid.passed, false);
  assert.match(invalid.notes, /Validation failed/);
  const directory = workspace(t);
  assert.throws(() => saveEvidence(directory, 'oq', [{ ...invalid, passed: true }]), /capture failure/);
});

test('automatic PQ corrections cannot satisfy manual backup, recovery or regulatory mappings', async t => {
  const directory = workspace(t);
  saveEvidence(directory, 'pq', [result({ testCaseId: 'PQ-021' }), result({ testCaseId: 'PQ-022' })]);
  const { generate: traceability } = await import('../generators/06-traceability-matrix');
  const { generate: protocol } = await import('../generators/09-pq-protocol');
  const { generate: summary } = await import('../generators/12-validation-summary');
  traceability(directory, directory); protocol(directory, directory); summary(directory, directory);
  const trace = fs.readFileSync(path.join(directory, '06-traceability-matrix.md'), 'utf8');
  for (const title of ['Backup process (AES-256)', 'Archive/retrieval process', 'Records retrievable for retention period']) {
    const row = trace.split('\n').find(line => line.includes(title));
    assert.ok(row, title); assert.match(row, /PQM-02[12]/); assert.match(row, /Pending/); assert.doesNotMatch(row, /\bPASS\b/);
  }
  const content = fs.readFileSync(path.join(directory, '09-pq-protocol.md'), 'utf8');
  assert.match(content, /PQM-022/); assert.match(content, /does not satisfy a same-numbered manual case/);
  const vsr = fs.readFileSync(path.join(directory, '12-validation-summary.md'), 'utf8');
  const row = vsr.split('\n').find(line => line.includes('11.10(c)') && line.includes('Record protection'));
  assert.ok(row); assert.match(row, /Pending/); assert.doesNotMatch(row, /\bPASS\b/);
});

// ── Truthful CSA/URS reporting and the multi-device session policy ──

const OBSERVED_ORIGIN = 'http://qualification.invalid:3100';

/** A fabricated passing row whose endpoint carries a known origin. */
function observed(testCaseId: string, overrides: Partial<EvidenceResult> = {}): EvidenceResult {
  return result({ testCaseId, endpoint: `${OBSERVED_ORIGIN}/api/synthetic/${testCaseId}`, ...overrides });
}

function csaRecord(directory: string): string {
  generateCsaAssurance(directory, directory);
  return fs.readFileSync(path.join(directory, '19-csa-feature-assurance.md'), 'utf8');
}

function featureRecord(content: string, featureId: string): string {
  const start = content.indexOf(`\n## ${featureId}:`);
  assert.ok(start >= 0, `${featureId} section`);
  const end = content.indexOf('\n## ', start + 1);
  return content.slice(start, end < 0 ? undefined : end);
}

function subsection(record: string, heading: string): string {
  const start = record.indexOf(`### ${heading}`);
  assert.ok(start >= 0, heading);
  const end = record.indexOf('\n### ', start + 1);
  return record.slice(start, end < 0 ? undefined : end);
}

function tableRow(text: string, firstCell: string): string {
  const line = text.split('\n').find(candidate => candidate.startsWith(`| ${firstCell} |`));
  assert.ok(line, firstCell);
  return line;
}

function caseRow(record: string, testCaseId: string): string {
  const line = record.split('\n').find(candidate => candidate.includes(` | ${testCaseId} | `));
  assert.ok(line, testCaseId);
  return line;
}

function assertNoInventedRecordFacts(content: string): void {
  assert.doesNotMatch(content, /Validation Team/);
  assert.equal(content.includes(SYSTEM_INFO.environments.production.apiUrl), false, 'production URL is never an observed environment');
  assert.doesNotMatch(content, /No issues found/i);
  assert.doesNotMatch(content, /exploratory testing and manual verification/i);
  assert.doesNotMatch(content, /^The .+ feature is acceptable for its intended use/m);
}

test('CSA records without retained evidence state no conclusion and invent no tester, date, environment or approval', t => {
  const content = csaRecord(workspace(t));
  assertNoInventedRecordFacts(content);
  assert.doesNotMatch(content, /acceptable for its intended use/);
  const authentication = featureRecord(content, 'FEAT-001');
  assert.match(subsection(authentication, 'Conclusion'), /Not executed — no conclusion/);
  assert.match(subsection(authentication, 'Issues Found'), /Not assessed: no retained evidence/);
  assert.match(tableRow(authentication, 'Tested By'), /Not recorded in retained evidence/);
  assert.match(tableRow(authentication, 'Test Date'), /Not executed/);
  assert.match(tableRow(authentication, 'Test Environment'), /Not recorded/);
  assert.match(tableRow(authentication, 'Approved By'), /_{10,}/);
  assert.match(tableRow(authentication, 'Approval Date'), /____\/____\/____/);
  const undocumented = featureRecord(content, 'FEAT-060');
  assert.match(subsection(undocumented, 'Conclusion'), /No assurance conclusion/);
  assert.match(subsection(undocumented, 'Issues Found'), /Not assessed: no retained evidence/);
  const unimplemented = content.split('\n').filter(line => /OQ-07[1-5]\b/.test(line));
  assert.ok(unimplemented.length > 0, 'unimplemented OQ-071..OQ-075 stay visible as gaps');
  for (const line of unimplemented) {
    assert.match(line, /not implemented/);
    assert.match(line, /Gap — no executed case mapped; not qualified/);
  }
  assert.doesNotMatch(content, /\| OQ-07[1-5] \|/, 'an unimplemented case is never a mapped test');
});

test('CSA conclusion for fully passing mapped evidence cites the observed run without establishing approval', t => {
  const directory = workspace(t);
  saveEvidence(directory, 'oq', [
    observed('OQ-032', { timestamp: '2026-09-21T10:00:00.000Z', testDescription: 'Observed synthetic audit CSV comparison' }),
    observed('OQ-193', { timestamp: '2026-09-22T09:30:00.000Z' }),
  ]);
  const content = csaRecord(directory);
  assertNoInventedRecordFacts(content);
  const exported = featureRecord(content, 'FEAT-013');
  const conclusion = subsection(exported, 'Conclusion');
  assert.match(conclusion, /All 2 mapped checks passed in the retained run/);
  assert.match(conclusion, /supports, but does not by itself establish/);
  assert.match(conclusion, /signature block/);
  assert.match(conclusion, /1 planned activity has no executed case mapped/);
  assert.match(subsection(exported, 'Issues Found'), /No failures were recorded/);
  assert.match(caseRow(exported, 'OQ-032'), /Observed synthetic audit CSV comparison/);
  assert.match(caseRow(exported, 'OQ-032'), /✅ Pass/);
  assert.match(caseRow(exported, 'OQ-193'), /Not recorded in retained evidence/);
  assert.match(tableRow(exported, 'Test Date'), /2026-09-21 to 2026-09-22/);
  assert.match(tableRow(exported, 'Test Environment'), /Observed endpoint origin: http:\/\/qualification\.invalid:3100/);
  assert.match(tableRow(exported, 'Tested By'), /Not recorded in retained evidence/);
});

test('a failed mapped check makes the feature not acceptable and lists the retained failure', t => {
  const directory = workspace(t);
  saveEvidence(directory, 'pq', [observed('PQ-030'), observed('PQ-031', { passed: false, notes: 'Synthetic frozen-form write was accepted' }), observed('PQ-032')]);
  saveEvidence(directory, 'oq', [observed('OQ-055')]);
  const freeze = featureRecord(csaRecord(directory), 'FEAT-050');
  assert.match(subsection(freeze, 'Conclusion'), /Not acceptable/);
  assert.match(subsection(freeze, 'Conclusion'), /PQ-031/);
  assert.doesNotMatch(subsection(freeze, 'Conclusion'), /supports, but does not/);
  assert.match(subsection(freeze, 'Issues Found'), /PQ-031.*Synthetic frozen-form write was accepted/);
  assert.match(caseRow(freeze, 'PQ-031'), /❌ Fail/);
});

test('partial and manual mapped evidence leave the feature without an assurance conclusion', t => {
  const directory = workspace(t);
  saveEvidence(directory, 'pq', [observed('PQ-033'), observed('PQ-034')]);
  saveEvidence(directory, 'oq', [
    ...['OQ-010', 'OQ-021', 'OQ-022', 'OQ-062', 'OQ-087', 'OQ-094'].map(id => observed(id)),
    manualResult('OQ-007', 'Synthetic manual fingerprint readback is outstanding'),
  ]);
  const content = csaRecord(directory);
  const lock = featureRecord(content, 'FEAT-051');
  assert.match(subsection(lock, 'Conclusion'), /Incomplete — no conclusion/);
  assert.match(subsection(lock, 'Conclusion'), /OQ-053/);
  assert.doesNotMatch(subsection(lock, 'Conclusion'), /supports, but does not/);
  assert.match(caseRow(lock, 'OQ-053'), /Not executed — no retained evidence/);
  const session = featureRecord(content, 'FEAT-005');
  assert.match(subsection(session, 'Conclusion'), /Manual verification pending/);
  assert.doesNotMatch(subsection(session, 'Conclusion'), /supports, but does not/);
  assert.match(caseRow(session, 'OQ-007'), /Manual verification pending/);
  assert.doesNotMatch(caseRow(session, 'OQ-007'), /Pass/);
  assert.match(tableRow(session, 'Test Environment'), /Observed endpoint origin: http:\/\/qualification\.invalid:3100/);
});

test('passing evidence for unmapped or previously mis-cited case IDs does not count toward a feature', t => {
  const directory = workspace(t);
  saveEvidence(directory, 'oq', ['OQ-071', 'OQ-072', 'OQ-073', 'OQ-074', 'OQ-079', 'OQ-080', 'OQ-081', 'OQ-082',
    'OQ-097', 'OQ-098', 'OQ-099', 'OQ-100'].map(id => observed(id)));
  const content = csaRecord(directory);
  assertNoInventedRecordFacts(content);
  assert.match(subsection(featureRecord(content, 'FEAT-033'), 'Conclusion'), /No assurance conclusion/);
  const reauthentication = featureRecord(content, 'FEAT-022');
  assert.match(subsection(reauthentication, 'Conclusion'), /Not executed — no conclusion/);
  for (const id of ['OQ-079', 'OQ-080', 'OQ-081', 'OQ-082']) assert.equal(reauthentication.includes(id), false, id);
  const linking = featureRecord(content, 'FEAT-023');
  assert.match(subsection(linking, 'Conclusion'), /Not executed — no conclusion/);
  assert.doesNotMatch(linking, /✅ Pass/);
});

test('every generated session statement keeps independent multi-device sessions and the separate URS-010 binding gap', t => {
  const directory = workspace(t);
  const generators: Array<[string, (outputDir: string, workspaceRoot: string) => void]> = [
    ['03-user-requirements-spec', generateUrs], ['04-functional-requirements-spec', generateFrs],
    ['05-risk-assessment', generateRiskAssessment], ['06-traceability-matrix', generateTraceability],
    ['08-oq-protocol', generateOqProtocol], ['14-hipaa-assessment', generateHipaa],
    ['18-regulatory-requirements-map', generateRegulatoryMap], ['19-csa-feature-assurance', generateCsaAssurance],
    ['21-design-specification', generateDesignSpec],
  ];
  const documents = new Map<string, string>();
  for (const [name, generate] of generators) {
    generate(directory, directory);
    documents.set(name, fs.readFileSync(path.join(directory, `${name}.md`), 'utf8'));
  }
  for (const [name, content] of documents) {
    for (const contradiction of [/blocked on new login/i, /new login invalidates/i, /only (?:the )?latest session/i,
      /old session (?:is )?(?:blocked|invalidated)/i, /prevent concurrent sessions/i, /prior[- ]session/i, /single[- ]session/i]) {
      assert.doesNotMatch(content, contradiction, `${name}: ${contradiction}`);
    }
    assert.match(content, /a new login does not end other sessions/i, name);
  }
  const urs = documents.get('03-user-requirements-spec')!;
  assert.match(tableRow(urs, 'URS-011'), /simultaneous independent sessions/i);
  assert.match(tableRow(urs, 'URS-011'), /verified independently/i);
  assert.match(tableRow(urs, 'URS-010'), /UNRESOLVED/);
  assert.match(tableRow(urs, 'URS-010'), /not enforced device binding/i);
  const frs = documents.get('04-functional-requirements-spec')!;
  assert.match(tableRow(frs, 'FRS-005'), /\| URS-010 \|/);
  assert.match(tableRow(frs, 'FRS-015'), /\| URS-011 \|/);
  assert.match(tableRow(frs, 'FRS-015'), /OQ-094/);
  const session = featureRecord(documents.get('19-csa-feature-assurance')!, 'FEAT-005');
  const binding = session.split('\n').find(line => line.startsWith('| ') && line.includes('URS-010'));
  assert.ok(binding, 'FEAT-005 keeps the URS-010 binding gap');
  assert.match(binding, /Gap — no executed case mapped; not qualified/);
  assert.match(caseRow(session, 'OQ-094'), /Not executed — no retained evidence/);
});

test('the URS is a specification: planned verification cites actual cases and explicit gaps, never invented history', t => {
  const directory = workspace(t);
  generateUrs(directory, directory);
  const urs = fs.readFileSync(path.join(directory, '03-user-requirements-spec.md'), 'utf8');
  assert.doesNotMatch(urs, /Verified through/);
  assert.match(urs, /Planned Verification/);
  assert.match(urs, /Gap — no executed case mapped/);
  assert.match(urs, /OQ-009 — Synthetic fixture only: up to seven wrong-password logins/);
  assert.doesNotMatch(urs, /OQ-006 \(lockout/);
  assert.doesNotMatch(urs, /2025-06-15|Approved for validation|QA Lead, Project Manager|System Architect/);
  assert.match(urs, /records no approvals/);
  assert.match(urs, /kept by document control/);
});

test('PQ refuses to run without explicitly configured operator credentials', async t => {
  const names = ['OQ_USERNAME', 'OQ_PASSWORD', 'PQ_USERNAME', 'PQ_PASSWORD'];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  for (const name of names) delete process.env[name];
  assert.throws(() => pqCredentials(), /PQ_USERNAME.*PQ_PASSWORD/);
  process.env.PQ_USERNAME = 'synthetic-pq-operator';
  assert.throws(() => pqCredentials(), (error: unknown) => error instanceof Error
    && /PQ_PASSWORD/.test(error.message) && !/PQ_USERNAME/.test(error.message));
  process.env.PQ_PASSWORD = 'synthetic-pq-secret';
  assert.deepEqual(pqCredentials(), { username: 'synthetic-pq-operator', password: 'synthetic-pq-secret' });
  process.env.OQ_USERNAME = 'synthetic-oq-operator';
  process.env.OQ_PASSWORD = 'synthetic-oq-secret';
  assert.deepEqual(pqCredentials(), { username: 'synthetic-oq-operator', password: 'synthetic-oq-secret' });
  for (const name of names) delete process.env[name];
  const fetchMock = t.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
    throw new Error('PQ must not contact the API without configured credentials');
  });
  await assert.rejects(runPq(workspace(t), 'https://qualification.invalid'), /PQ_USERNAME/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('no runner has a built-in operator: credentials come only from the environment', async t => {
  const names = ['OQ_USERNAME', 'OQ_PASSWORD', 'PQ_USERNAME', 'PQ_PASSWORD'];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  for (const name of names) delete process.env[name];
  assert.throws(() => qualificationCredentials(), /Qualification operator credentials are not configured: set OQ_USERNAME and OQ_PASSWORD/);
  // Runners whose other checks run unauthenticated (DR, security) open no session.
  assert.equal(optionalQualificationCredentials(), null);
  process.env.OQ_USERNAME = 'synthetic-oq-operator';
  for (const lookup of [qualificationCredentials, optionalQualificationCredentials]) {
    assert.throws(() => lookup(), (error: unknown) => error instanceof Error
      && /OQ_PASSWORD/.test(error.message) && !/OQ_USERNAME/.test(error.message));
  }
  process.env.OQ_PASSWORD = 'synthetic-oq-secret';
  const configured = { username: 'synthetic-oq-operator', password: 'synthetic-oq-secret' };
  assert.deepEqual(qualificationCredentials(), configured);
  assert.deepEqual(optionalQualificationCredentials(), configured);
  assert.deepEqual(qualificationCredentials({ username: 'runner-variable', password: 'runner-secret' }), configured);
  for (const name of names) delete process.env[name];
  const fetchMock = t.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
    throw new Error('A runner must not contact the API without configured credentials');
  });
  await assert.rejects(runOq(workspace(t), 'https://qualification.invalid'), /OQ_USERNAME and OQ_PASSWORD/);
  await assert.rejects(runPerformance(workspace(t), 'https://qualification.invalid'), /OQ_USERNAME and OQ_PASSWORD/);
  assert.equal(fetchMock.mock.callCount(), 0);
});
