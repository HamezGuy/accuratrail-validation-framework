import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadEvidence, saveEvidence, captureWithExpectedStatus, captureWithValidator, type EvidenceResult,
} from '../runners/evidence-capture';
import { loadRunnerEvidence, tryLoadEvidence } from '../generators/helpers/evidence-linker';
import { generate as generateExecutionRecords } from '../generators/20-test-execution-records';
import { login } from '../runners/auth';

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
