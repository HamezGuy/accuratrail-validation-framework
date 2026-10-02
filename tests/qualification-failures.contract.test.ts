import test from 'node:test';
import assert from 'node:assert/strict';
import { runAuthenticationTests, runPart11ComplianceTests, runDataOperationTests, runComprehensiveAuditTests, runSecurityValidationTests,
  runComprehensiveAuthTests, runComprehensiveRbacTests, captureAuditRefusal, captureNativeDownload, captureAuditDownload,
  captureSignaturePasswordRefusal, captureMissingChangeReason, type OwnedOqFixture } from '../runners/oq-runner';
import { createWorkflowState, runStudySetup, archiveOwnedStudy } from '../runners/pq-runner';
import { workspace } from './study-contract-fixtures';
import { syntheticStudyDefinition } from '../runners/qualification-fixture';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testXssInjection, testPathTraversal, testCorsPreflight, testErrorLeakage } from '../runners/security-runner';
import { captureWithValidator, captureWithExpectedStatus, redactEvidenceSecrets } from '../runners/evidence-capture';

const baseUrl = 'https://qualification.invalid';

test('retained password-change evidence redacts native current/new password fields without losing revision identity', () => {
  assert.deepEqual(redactEvidenceSecrets({ requestBody: { currentPassword: 'private-current', newPassword: 'private-new',
    oldPassword: 'private-old', confirmPassword: 'private-confirm', revisionToken: 'native-revision' } }), {
    requestBody: { currentPassword: '[redacted]', newPassword: '[redacted]', oldPassword: '[redacted]',
      confirmPassword: '[redacted]', revisionToken: 'native-revision' },
  });
});
function ownedFixture(): OwnedOqFixture {
  const studyWorkspace = workspace(syntheticStudyDefinition('OQ-CONTRACT'));
  studyWorkspace.summary.oid = 'S_OWNED';
  return { setup: [], results: [], state: Object.assign(createWorkflowState(baseUrl, 'operator'), {
    studyId: 42, subjectId: 81, formDataId: 111, subjectLabel: 'OQ-OWNED-SUBJECT', studyWorkspace,
    values: { weight: 0, notes: 'Fictional, "quoted"\n' + '日本語'.repeat(900) },
  }) };
}

function reviewedFixture() {
  const fixture = ownedFixture(); Object.assign(fixture.state, { formId: 71, crfVersionId: 72, visitId: 91,
    formItems: { weight: 103 }, values: { weight: '70.5' }, qualification: { username: 'operator', password: 'private', reason: 'Synthetic qualification' } });
  return fixture;
}
function nativeForm(weight = '70.5', revision = 1) {
  return { eventCrfId: 111, studyId: 42, studySubjectId: 81, studyEventId: 91, crfId: 71, crfVersionId: 72,
    execution: null, observationPreconditionContract: 'edc-form-observation-preconditions/1', observationSnapshotHash: `sha256:${String(revision).repeat(64)}`,
    formData: { item_103: weight }, data: [{ itemId: 103, itemDataId: 1103, value: weight }], lockStatus: { locked: false } };
}
for (const mode of ['missing', 'wrong'] as const) for (const defect of ['none', 'unrelated-refusal', 'changed-signature'])
  test(`signature password refusal uses the native contract and exact retained proof: ${mode}/${defect}`, async t => {
    const fixture = reviewedFixture(); let attempts = 0, proofs = 0, positiveCredentials = 0;
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
      assert.ok(String(url).startsWith(baseUrl)); const p = new URL(url).pathname;
      let status = 200, body: any;
      if (p === '/api/forms/data/111') body = { success: true, data: nativeForm() };
      else if (p === '/api/esignature/status/eventCrf/111') body = { success: true, data: { contract: 'edc-event-crf-signature-proof/1',
        entityId: 111, studyId: 42, isSigned: true, signatureIntegrityValid: true, activeSignature: { signatureId: defect === 'changed-signature' && ++proofs > 1 ? 999 : 222 } } };
      else if (p === '/api/esignature/verify-password') { positiveCredentials++; assert.deepEqual(JSON.parse(String(init.body)), { username: 'operator', password: 'private' }); body = { success: true, data: { valid: true } }; }
      else { assert.equal(p, '/api/esignature/sign'); attempts++; const sent = JSON.parse(String(init.body));
        assert.equal(sent.entityType, 'eventCrf'); assert.equal(sent.entityId, 111); assert.equal(sent.meaning, 'approval');
        assert.equal(sent.username, 'operator'); assert.equal(sent.expectedExecution, null); assert.equal(sent.expectedObservations.snapshotHash, nativeForm().observationSnapshotHash);
        assert.equal(sent.eventCrfId, undefined); assert.equal(sent.signaturePassword, undefined);
        assert.equal(mode === 'wrong' ? typeof sent.password === 'string' && sent.password !== 'private' : sent.password === undefined, true);
        status = 400; body = { success: false, ...(mode === 'wrong'
          ? { message: defect === 'unrelated-refusal' ? 'Invalid entityType' : 'Invalid password' }
          : { errors: [{ field: defect === 'unrelated-refusal' ? 'entityId' : 'password', type: 'any.required' }] }) };
      }
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    });
    const result = await captureSignaturePasswordRefusal(baseUrl, 'operator', mode, fixture);
    assert.equal(result.passed, defect === 'none'); assert.equal(attempts, 1); assert.equal(positiveCredentials, mode === 'wrong' ? 2 : 0);
  });

for (const defect of ['none', 'accepted', 'unrelated-refusal']) test(`reasonless clinical correction checks real refusal and restores a defective acceptance: ${defect}`, async t => {
  const fixture = reviewedFixture(); let weight = '70.5', revision = 1, writes = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    assert.ok(String(url).startsWith(baseUrl)); const p = new URL(url).pathname;
    let status = 200, result: any;
    if (p === '/api/forms/data/111') result = { success: true, data: nativeForm(weight, revision) };
    else { assert.equal(p, '/api/forms/save'); assert.equal(init.method, 'POST'); const sent = JSON.parse(String(init.body)); writes++;
      assert.equal(sent.eventCrfId, 111); assert.equal(sent.studyId, 42); assert.equal(sent.subjectId, 81); assert.equal(sent.crfId, 71); assert.equal(sent.studyEventId, 91);
      assert.equal(sent.expectedObservations.snapshotHash, nativeForm(weight, revision).observationSnapshotHash);
      if (writes === 1) { assert.equal(sent.reasonForChange, undefined); assert.equal(sent.formData.item_103, '71.5');
        if (defect === 'accepted') { weight = sent.formData.item_103; revision++; result = { success: true }; }
        else { status = 400; result = { success: false, code: defect === 'none' ? 'REASON_FOR_CHANGE_REQUIRED' : 'INVALID_FORM' }; }
      } else { assert.equal(defect, 'accepted'); assert.match(sent.reasonForChange, /Restore/); assert.equal(sent.formData.item_103, '70.5'); weight = sent.formData.item_103; revision++; result = { success: true }; }
    }
    return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
  });
  const result = await captureMissingChangeReason(baseUrl, fixture.state);
  assert.equal(result.passed, defect === 'none'); assert.equal(weight, '70.5'); assert.equal(writes, defect === 'accepted' ? 2 : 1);
});

for (const defect of ['none', 'foreign', 'changed', 'server']) test(`audit refusal verifies an owned record before and after: ${defect}`, async t => {
  const calls: string[] = []; let reads = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${new URL(url).pathname}`; calls.push(route);
    if (route === 'GET /api/audit/form/111') return new Response(JSON.stringify({ success: true, data: [{ auditId: 777,
      eventCrfId: 111, studyId: defect === 'foreign' ? 99 : 42, newValue: defect === 'changed' && ++reads > 1 ? 'tampered' : 'original' }] }), { headers: { 'Content-Type': 'application/json' } });
    assert.equal(route, 'DELETE /api/audit/777');
    return new Response(JSON.stringify({ success: false }), { status: defect === 'server' ? 500 : 404, headers: { 'Content-Type': 'application/json' } });
  });
  const result = await captureAuditRefusal('OQ-131', baseUrl, 'operator', 'DELETE', ownedFixture());
  assert.equal(result.passed, defect === 'none');
  assert.equal(calls.includes('DELETE /api/audit/777'), defect !== 'foreign');
  if (defect === 'none') assert.equal(result.relatedEvidence!.length, 3);
});

for (const defect of ['none', 'foreign', 'missing-item', 'wrong-value', 'duplicate']) test(`CSV download retains complete content and exact fixture values: ${defect}`, async t => {
  const fixture = ownedFixture(), rows = Object.entries(fixture.state.values!).map(([name, value]) => [fixture.state.subjectLabel, name, String(value)]);
  if (defect === 'missing-item') rows.pop();
  if (defect === 'wrong-value') rows[0][2] = '123';
  if (defect === 'duplicate') rows.push(rows[0]);
  const csv = [['SubjectID', 'ItemName', 'ItemValue'], ...rows].map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
  let downloads = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === '/api/forms/data/111') return new Response(JSON.stringify({ success: true, data: { eventCrfId: 111, studyId: defect === 'foreign' ? 99 : 42 } }), { headers: { 'Content-Type': 'application/json' } });
    assert.equal(path, '/api/export/execute'); downloads++;
    assert.deepEqual(JSON.parse(String(init.body)), { datasetConfig: { studyOID: 'S_OWNED' }, format: 'csv' });
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
  });
  const result = await captureNativeDownload('OQ-047', baseUrl, 'operator', 'csv', fixture);
  assert.equal(result.passed, defect === 'none');
  assert.equal(downloads, defect === 'foreign' ? 0 : 1);
  if (defect === 'none') assert.equal(result.responseBody, csv, 'Download evidence may not truncate Unicode or quoted records');
});

for (const invalid of [false, true]) test(`PDF download retains exact bytes and refuses a JSON substitute: ${invalid}`, async t => {
  const bytes = invalid ? Buffer.from('{"success":true}') : Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(3000, 129), Buffer.from('\n%%EOF\n')]);
  t.mock.method(globalThis, 'fetch', async (url: string) => new URL(url).pathname === '/api/forms/data/111'
    ? new Response(JSON.stringify({ success: true, data: { eventCrfId: 111, studyId: 42 } }), { headers: { 'Content-Type': 'application/json' } })
    : new Response(bytes, { headers: { 'Content-Type': invalid ? 'application/json' : 'application/pdf' } }));
  const result = await captureNativeDownload('OQ-048', baseUrl, 'operator', 'pdf', ownedFixture());
  assert.equal(result.passed, !invalid);
  const body = result.responseBody as any;
  assert.equal(body.byteLength, bytes.length); assert.equal(body.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(Buffer.from(body.content, 'base64'), bytes);
});

for (const missing of [false, true]) test(`audit CSV requires the exact correction independently read from the native form: ${missing}`, async t => {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const u = new URL(url);
    if (u.pathname === '/api/audit/form/111') return new Response(JSON.stringify({ success: true, data: [{ studyId: 42, eventCrfId: 111,
      entityId: 333, userName: 'operator', oldValue: '75', newValue: '70.5', reasonForChange: 'PQ verified synthetic weight correction' }] }), { headers: { 'Content-Type': 'application/json' } });
    assert.equal(u.pathname, '/api/audit/export'); assert.equal(u.searchParams.get('studyId'), '42');
    return new Response('Entity ID,Old Value,New Value,Reason for Change,Username\n'
      + (missing ? '' : '333,75,70.5,PQ verified synthetic weight correction,operator\n'), { headers: { 'Content-Type': 'text/csv' } });
  });
  assert.equal((await captureAuditDownload('OQ-032', baseUrl, 'operator', ownedFixture())).passed, !missing);
});

test('password change probes use only an owned viewer and disable it afterward', async t => {
  let user: any; const changes: any[] = [];
  const accessToken = `e30.${Buffer.from(JSON.stringify({ userId: 77, exp: Math.floor(Date.now()/1000)+600 })).toString('base64url')}.viewer`;
  const access = () => accessToken;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname, method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    let status = 200, result: any = { success: true, data: { userId: 77 } };
    if (path === '/api/users' && method === 'POST') { user = { userId: 77, userName: body.username, password: body.password, email: body.email, enabled: true, platformRole: 'viewer' }; status = 201; result = { success: true, userId: 77 }; }
    else if (path === '/api/users/77') { if (method === 'PUT') user.enabled = false; const { password, ...read } = user; result = { success: true, data: read }; }
    else if (path === '/api/auth/login') {
      assert.notEqual(body?.username, 'operator', 'Operator must not be targeted by these probes');
      if (body?.username === user.userName && body?.password === user.password) result = { success: true, accessToken: access(), refreshToken: 'viewer-refresh', user: { userId: 77 } };
      else { status = 401; result = { success: false }; }
    } else if (path === '/api/auth/change-password') { changes.push({ body, headers: init.headers }); status = 400; result = { success: false,
      ...(body.newPassword === '123' ? { error: 'PASSWORD_POLICY_VIOLATION', errors: ['Password must have at least eight characters'] } : {}) }; }
    else if (path === '/api/auth/refresh') { if (body.refreshToken === 'viewer-refresh') result = { success: true, accessToken: access() }; else { status = 401; result = { success: false }; } }
    return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
  });
  const result = await runComprehensiveAuthTests(baseUrl, 'operator', 'operator-secret', 'operator-session', true);
  assert.equal(changes.length, 3);
  assert.ok(changes.every(row => new Headers(row.headers).get('authorization') === 'Bearer ' + access()));
  assert.ok(changes.every(row => row.body.currentPassword !== 'operator-secret'));
  for (const id of ['OQ-087', 'OQ-091', 'OQ-092', 'OQ-093', 'OQ-PASSWORD-CLEANUP']) assert.equal(result.find(row => row.testCaseId === id)!.passed, true, id);
  assert.equal(user.enabled, false);
});

for (const suite of ['authentication', 'password'] as const) for (const foreign of [false, true])
  test(`${suite} retains the created ID after failed readback and only cleans up the exact owned identity: ${foreign}`, async t => {
    let user: any, reads = 0, disabled = 0;
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
      assert.ok(String(url).startsWith(baseUrl));
      const p = new URL(url).pathname, method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
      let status = 400, data: any = { success: false };
      if (p === '/api/auth/login') { status = 200; data = { success: true, accessToken: `e30.${Buffer.from(JSON.stringify({ userId: 7, role: 'admin', exp: Date.now()/1000+600 })).toString('base64url')}.fixture`, user: { userId: 7 } }; }
      if (p === '/api/users' && method === 'POST') { user = { userId: 77, userName: body.username, email: body.email, enabled: true, platformRole: 'viewer' }; status = 201; data = { success: true, userId: 77 }; }
      if (p === '/api/users/77' && method === 'GET') { status = ++reads === 1 ? 503 : 200; data = status === 503 ? { success: false } : { success: true, data: { ...user, ...(foreign ? { userName: 'pre-existing-foreign' } : {}) } }; }
      if (p === '/api/users/77' && method === 'PUT') { assert.equal(foreign, false); disabled++; user.enabled = false; status = 200; data = { success: true }; }
      if (p === '/api/auth/logout') { status = 200; data = { success: true }; }
      return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    });
    const results = suite === 'authentication' ? await runAuthenticationTests(baseUrl, 'operator', 'operator-secret', true)
      : await runComprehensiveAuthTests(baseUrl, 'operator', 'operator-secret', 'operator-session', true);
    const prefix = suite === 'authentication' ? 'OQ-AUTH' : 'OQ-PASSWORD';
    assert.equal(results.find(row => row.testCaseId === `${prefix}-FIXTURE`)!.passed, false);
    assert.equal(results.find(row => row.testCaseId === `${prefix}-CLEANUP`)!.passed, !foreign);
    assert.equal(disabled, foreign ? 0 : 1);
  });

test('an unexpected OQ suite error still archives only its owned study, closes its session, and retains the case denominator', async t => {
  const pq = require('../runners/pq-runner'), auth = require('../runners/auth'), oq = require('../runners/oq-runner');
  const evidence = { testCaseId: 'OQ-LOGIN', timestamp: new Date().toISOString(), endpoint: '/api/auth/login', method: 'POST', responseStatus: 200, responseBody: { success: true }, passed: true, notes: 'Offline session fixture' };
  const study = workspace(syntheticStudyDefinition('OQ-THROW'));
  t.mock.method(auth, 'login', async (_url: string, _username: string, _password: string, testCaseId = 'OQ-LOGIN') => ({
    evidence: { ...evidence, testCaseId }, session: { token: 'operator-owned-session', userId: 7, orgId: 8 } }));
  t.mock.method(pq, 'runStudySetup', async (_url: string, state: any) => { state.studyId = 42; state.studyWorkspace = study; return [{ ...evidence, testCaseId: 'PQ-001' }]; });
  t.mock.method(pq, 'runDataEntry', async () => { throw new Error('Offline unexpected suite failure'); });
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    assert.ok(String(url).startsWith(baseUrl));
    const route = `${init.method ?? 'GET'} ${new URL(url).pathname}`; calls.push(route);
    if (route === 'DELETE /api/studies/42') { study.executionContext.entityStatus = { id: 5, label: 'removed' }; return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } }); }
    if (route === 'GET /api/studies/42') return new Response(JSON.stringify({ success: true, data: study }), { headers: { 'Content-Type': 'application/json' } });
    if (route === 'POST /api/auth/logout') return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ success: false }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  });
  const output = mkdtempSync(path.join(tmpdir(), 'oq-cleanup-contract-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const results = await oq.run(output, baseUrl, undefined, ['--synthetic-qualification', '--allow-production-qualification']);
  assert.equal(results.find((row: any) => row.testCaseId === 'OQ-EXECUTION').passed, false);
  assert.equal(results.find((row: any) => row.testCaseId === 'OQ-RUN-LOGOUT').passed, true);
  assert.equal(results.filter((row: any) => /^OQ-\d{3}$/.test(row.testCaseId)).length, 205);
  assert.equal(calls.filter(route => route.startsWith('DELETE ')).join(), 'DELETE /api/studies/42');
  assert.equal(calls.at(-1), 'POST /api/auth/logout');
  assert.equal(results.find((row: any) => row.testCaseId === 'OQ-NATIVE-RETENTION').relatedEvidence.find((row: any) => row.testCaseId === 'PQ-040').passed, true);
});

for (const defect of ['missing-role', 'bad-id', 'bad-exp', 'valid']) test(`JWT case requires real numeric identity, role and finite future expiry: ${defect}`, async t => {
  const payload: any = { userId: 7, role: 'admin', exp: Date.now()/1000+600 };
  if (defect === 'missing-role') delete payload.role;
  if (defect === 'bad-id') payload.userId = '7';
  if (defect === 'bad-exp') payload.exp = 'far-future';
  const token = `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fixture`;
  t.mock.method(globalThis, 'fetch', async (url: string) => new Response(JSON.stringify(new URL(url).pathname === '/api/auth/login'
    ? { success: true, accessToken: token } : { success: false }), { headers: { 'Content-Type': 'application/json' } }));
  assert.equal((await runAuthenticationTests(baseUrl, 'operator', 'secret')).find(row => row.testCaseId === 'OQ-006')!.passed, defect === 'valid');
});
function replies(t: any, status: number, body: unknown) {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.ok(String(url).startsWith(baseUrl));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
}
for (const status of [500, 503]) test(`server failure ${status} never becomes a positive or negative qualification pass`, async t => {
  replies(t, status, { success: false, data: [{ signerName: 'Bogus', signedAt: '2026-01-01', meaning: 'approval', recordHash: 'a'.repeat(64) }] });
  const results = [...await runDataOperationTests(baseUrl, 'operator'), ...await runPart11ComplianceTests(baseUrl, 'operator', 'password', 'shared'),
    ...await runComprehensiveAuditTests(baseUrl, 'operator'), ...await runSecurityValidationTests(baseUrl, 'operator', 'operator', 'password')];
  assert.deepEqual(results.filter(row => row.passed).map(row => row.testCaseId), []);
  assert.equal((await captureWithValidator({ testCaseId: 'OQ-PROBE', baseUrl, url: '/probe', method: 'GET' }, () => ({ passed: true, notes: 'must not override server failure' }))).passed, false);
});
for (const status of [400, 404]) test(`missing or refused resources at HTTP ${status} cannot satisfy positive retrieval/export checks`, async t => {
  replies(t, status, { success: false, data: null });
  const results = await runDataOperationTests(baseUrl, 'operator');
  for (const id of ['OQ-045', 'OQ-047', 'OQ-048', 'OQ-049']) assert.equal(results.find(row => row.testCaseId === id)!.passed, false);
});
test('empty successful bodies cannot establish resources, audit login observations or hash-chain linkage', async t => {
  replies(t, 200, { success: true, data: [] });
  const results = await runComprehensiveAuditTests(baseUrl, 'operator');
  for (const id of ['OQ-127', 'OQ-133', 'OQ-134', 'OQ-135']) assert.equal(results.find(row => row.testCaseId === id)!.passed, false);
});
test('HTTP 200 success=false remains failed in expected-status and custom-validator capture', async t => {
  replies(t, 200, { success: false });
  assert.equal((await captureWithExpectedStatus({ testCaseId: 'OQ-PROBE', baseUrl, url: '/probe', method: 'GET' }, 200)).passed, false);
  assert.equal((await captureWithValidator({ testCaseId: 'OQ-PROBE', baseUrl, url: '/probe', method: 'GET' }, () => ({ passed: true, notes: 'HTTP status alone must not override a logical failure' }))).passed, false);
});

for (const version of [undefined, '', '   ', 123, '1.2.3']) test(`version observation requires an actual nonempty version: ${JSON.stringify(version)}`, async t => {
  replies(t, 200, { success: true, ...(version === undefined ? {} : { version }) });
  const result = (await runPart11ComplianceTests(baseUrl, 'operator', 'private', null)).find(row => row.testCaseId === 'OQ-070')!;
  assert.equal(result.passed, version === '1.2.3');
});

for (const foreign of [false, true]) test(`study creation retains cleanup custody after failed readback without enabling workflow: ${foreign}`, async t => {
  let created: ReturnType<typeof workspace>, reads = 0, archived = 0;
  const state = createWorkflowState(baseUrl, 'operator');
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    assert.ok(String(url).startsWith(baseUrl));
    const p = new URL(url).pathname, method = init.method ?? 'GET';
    let status = 200, result: any;
    if (p === '/api/studies' && method === 'POST') { created = workspace(JSON.parse(String(init.body)).content); status = 201; result = { success: true, data: created }; }
    else if (p === '/api/studies/42' && method === 'GET') {
      if (++reads === 1) { status = 503; result = { success: false }; }
      else { result = { success: true, data: structuredClone(created!) }; if (foreign) result.data.summary.primaryIdentifier = 'FOREIGN'; }
    } else if (p === '/api/studies/42' && method === 'DELETE') { assert.equal(foreign, false); archived++; created!.executionContext.entityStatus = { id: 5, label: 'removed' }; result = { success: true }; }
    else assert.fail(`Failed creation cannot enable downstream calls: ${method} ${p}`);
    return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
  });
  const setup = await runStudySetup(baseUrl, state, { username: 'operator', password: 'private', reason: 'Synthetic contract test' });
  assert.equal(setup[0].passed, false); assert.equal(state.studyWorkspace, undefined); assert.equal(state.studyId, null);
  assert.equal(state.createdStudyCleanupCandidate?.summary.studyId, 42);
  const cleanup = await archiveOwnedStudy(state);
  assert.equal(cleanup.passed, !foreign); assert.equal(archived, foreign ? 0 : 1);
});

test('OQ full-run authorization check reuses retained creation evidence without another unowned study', async t => {
  const fixture = ownedFixture();
  const source = { testCaseId: 'PQ-001', timestamp: new Date().toISOString(), endpoint: '/api/studies', method: 'POST', responseStatus: 201,
    responseBody: { success: true }, passed: true, notes: 'Canonical POST plus exact independent GET verified.' };
  fixture.results.push(source);
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    assert.ok(String(url).startsWith(baseUrl));
    assert.ok(!(new URL(url).pathname === '/api/studies' && init.method === 'POST'), 'May not create an extra untracked study');
    return new Response(JSON.stringify({ success: false }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  });
  const result = (await runComprehensiveRbacTests(baseUrl, 'operator', fixture)).find(row => row.testCaseId === 'OQ-097')!;
  assert.equal(result.passed, true); assert.deepEqual(result.relatedEvidence, [source]); assert.match(result.notes, /Shared native evidence PQ-001/);
});
for (const status of [404, 500]) test(`security probes do not infer XSS or CORS protection from HTTP ${status}`, async t => {
  replies(t, status, {});
  assert.equal((await testXssInjection(baseUrl, 'operator')).passed, false);
  assert.equal((await testCorsPreflight(baseUrl)).passed, false);
  if (status === 500) {
    assert.equal((await testPathTraversal(baseUrl)).passed, false);
    assert.equal((await testErrorLeakage(baseUrl)).passed, false);
  }
});

for (const nativeLockout of [true, false]) test(`authentication isolates an owned viewer and requires observed native lockout: ${nativeLockout}`, async t => {
  let user: any, counter = 0, sequence = 0;
  const invalidated = new Set<string>(), requests: any[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    assert.ok(String(url).startsWith(baseUrl));
    const path = new URL(url).pathname, method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, method, body, headers: init.headers });
    let status = 200, result: any = { success: true, data: {} };
    const header = new Headers(init.headers).get('authorization') ?? '';
    if (path === '/api/auth/login') {
      if (body.username === 'operator' && body.password === 'operator-secret') {
        result = { success: true, accessToken: `e30.${Buffer.from(JSON.stringify({ userId: 7, role: 'admin', exp: Date.now() / 1000 + 600 })).toString('base64url')}.session${++sequence}` };
      } else if (user && body.username === user.userName && body.password === user.password && user.statusId !== 5) {
        counter = 0; result = { success: true, accessToken: 'viewer-session' };
      } else {
        status = 401; result = { success: false, message: user && body.username === user.userName && user.statusId === 5 ? 'User account is locked' : 'Invalid username or password' };
        if (user && body.username === user.userName && user.statusId !== 5) { counter++; user.lockCounter = counter; if (nativeLockout && counter >= 5) user.statusId = 5; }
      }
    } else if (path === '/api/users' && method === 'POST') {
      if (user) { status = 400; result = { success: false, message: 'Username already exists' }; }
      else { user = { userId: 77, userName: body.username, email: body.email, platformRole: body.role, password: body.password, enabled: true, statusId: 1, lockCounter: 0 }; status = 201; result = { success: true, userId: 77 }; }
    } else if (path === '/api/users/77' && method === 'PUT') { assert.equal(body.enabled, false); user.enabled = false; }
    else if (path === '/api/users/77') { const { password, ...read } = user; result = { success: true, data: read }; }
    else if (path === '/api/auth/logout') invalidated.add(header);
    else if (path === '/api/auth/verify') { if (invalidated.has(header) || header.includes('invalid.token')) { status = 401; result = { success: false }; } }
    else { status = 400; result = { success: false }; }
    return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
  });
  const results = await runAuthenticationTests(baseUrl, 'operator', 'operator-secret', true);
  assert.equal(results.find(row => row.testCaseId === 'OQ-002')!.passed, true);
  assert.equal(results.find(row => row.testCaseId === 'OQ-009')!.passed, nativeLockout);
  assert.equal(results.find(row => row.testCaseId === 'OQ-008')!.passed, false, 'Missing rate-limit observation cannot pass');
  assert.equal(results.find(row => row.testCaseId === 'OQ-AUTH-CLEANUP')!.passed, true);
  assert.equal(user.enabled, false);
  assert.equal(requests.some(request => request.body?.username === 'operator' && request.body?.password !== 'operator-secret'), false);
  const mainSession = 'operator-shared-session';
  const later = await runPart11ComplianceTests(baseUrl, 'operator', 'operator-secret', mainSession, results);
  assert.equal(later.find(row => row.testCaseId === 'OQ-062')!.passed, true);
  assert.equal(invalidated.has('Bearer ' + mainSession), false);
  assert.equal(later.find(row => row.testCaseId === 'OQ-057')!.passed, nativeLockout);
  assert.equal(later.find(row => row.testCaseId === 'OQ-066')!.passed, true);
});
