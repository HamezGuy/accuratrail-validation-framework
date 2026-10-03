import test from 'node:test';
import assert from 'node:assert/strict';
import { runAuthenticationTests, runPart11ComplianceTests, runDataOperationTests, runComprehensiveAuditTests, runSecurityValidationTests,
  runComprehensiveAuthTests, runComprehensiveRbacTests, captureAuditRefusal, captureNativeDownload, captureAuditDownload,
  captureSignaturePasswordRefusal, captureMissingChangeReason, runAccountLifecycleTests, nativeCase, runRateLimitTest,
  captureOwnedUnlock, captureLifecycleAudit, captureSignatureAudit, captureSignatureCopyRefusal, type OwnedOqFixture } from '../runners/oq-runner';
import { createWorkflowState, runStudySetup, archiveOwnedStudy } from '../runners/pq-runner';
import { workspace } from './study-contract-fixtures';
import { syntheticStudyDefinition } from '../runners/qualification-fixture';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testXssInjection, testPathTraversal, testCorsPreflight, testErrorLeakage } from '../runners/security-runner';
import { captureWithValidator, captureWithExpectedStatus, redactEvidenceSecrets } from '../runners/evidence-capture';
import { captureLoginProbe } from '../runners/auth';

const baseUrl = 'https://qualification.invalid';

for (const defect of ['none', 'logout-unavailable', 'logout-false', 'still-active', 'wrong-refusal', 'bad-credentials', 'missing-token', 'nested-token'])
  test(`login-only qualification probe owns and verifies its session cleanup: ${defect}`, async t => {
    const active = new Set(['foreign-session']);
    const requests: Array<{ path: string; bearer: string | null }> = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
      const p = new URL(url).pathname, bearer = new Headers(init.headers).get('authorization');
      requests.push({ path: p, bearer });
      assert.equal(init.redirect, 'error');
      let status = 200, body: any = { success: true };
      if (p === '/api/auth/login') {
        assert.equal(init.method, 'POST');
        assert.deepEqual(JSON.parse(String(init.body)), { username: 'owned', password: 'OwnedPassword42!' });
        if (defect === 'bad-credentials') { status = 401; body = { success: false }; }
        else if (defect === 'missing-token') body = { success: true, user: { userId: 77 } };
        else {
          active.add('issued-probe');
          const payload = { accessToken: 'issued-probe', user: { userId: 77 } };
          body = defect === 'nested-token' ? { success: true, data: payload } : { success: true, ...payload };
        }
      } else {
        assert.equal(bearer, 'Bearer issued-probe', 'Only the session issued by this probe may be targeted');
        if (p === '/api/auth/logout') {
          assert.equal(init.method, 'POST');
          if (defect === 'logout-unavailable') throw new Error('Unavailable');
          if (defect === 'logout-false') body = { success: false };
          else if (defect !== 'still-active') active.delete('issued-probe');
        } else if (p === '/api/auth/verify') {
          assert.equal(init.method, 'GET');
          if (active.has('issued-probe')) body = { success: true, data: { userId: 77 } };
          else { status = 401; body = { success: false, error: { code: defect === 'wrong-refusal' ? 'INVALID_TOKEN' : 'SESSION_REVOKED' } }; }
        } else assert.fail(`Unexpected operation ${p}`);
      }
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    });
    const result = await captureLoginProbe(baseUrl, 'owned', 'OwnedPassword42!', 'OQ-PROBE');
    assert.equal(result.passed, ['none', 'nested-token'].includes(defect));
    assert.ok(active.has('foreign-session'));
    assert.equal(requests.length, ['bad-credentials', 'missing-token'].includes(defect) ? 1 : 3);
    if (requests.length === 3) {
      assert.deepEqual(result.relatedEvidence?.map(row => row.testCaseId), ['OQ-PROBE-logout', 'OQ-PROBE-logout-readback']);
      assert.ok(!JSON.stringify(result.relatedEvidence).includes('issued-probe'));
    }
    const retained = JSON.stringify(redactEvidenceSecrets(result));
    assert.ok(!retained.includes('OwnedPassword42!') && !retained.includes('issued-probe'));
  });

test('OQ operator claim and password-age probes release their sessions while preserving the caller session', async t => {
  const active = new Set(['foreign-session']);
  let serial = 0;
  const issue = () => {
    const token = `e30.${Buffer.from(JSON.stringify({ userId: 77, role: 'admin', exp: Date.now() / 1000 + 600, sid: `owned-${++serial}` })).toString('base64url')}.signature`;
    active.add(token); return token;
  };
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const p = new URL(url).pathname, bearer = new Headers(init.headers).get('authorization')?.replace('Bearer ', '');
    let status = 200, body: any = { success: true, data: [] };
    if (p === '/api/auth/login') {
      const request = JSON.parse(String(init.body));
      if (request.username !== 'owned' || request.password !== 'OwnedPassword42!') { status = 401; body = { success: false }; }
      else body = { success: true, accessToken: issue(), user: { userId: 77 }, passwordExpirationWarning: false };
    } else if (p === '/api/auth/logout') {
      assert.ok(bearer && bearer !== 'foreign-session'); active.delete(bearer); body = { success: true };
    } else if (p === '/api/auth/verify') {
      if (bearer && active.has(bearer)) body = { success: true, data: { userId: 77 } };
      else { status = 401; body = { success: false, error: { code: 'SESSION_REVOKED' } }; }
    }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  const authRows = await runAuthenticationTests(baseUrl, 'owned', 'OwnedPassword42!', false, true);
  const claims = authRows.find(row => row.testCaseId === 'OQ-006');
  assert.equal(claims?.passed, true);
  assert.ok(claims?.relatedEvidence?.every(row => row.passed));
  assert.deepEqual([...active], ['foreign-session']);
  const partRows = await runPart11ComplianceTests(baseUrl, 'owned', 'OwnedPassword42!', 'foreign-session');
  const policy = partRows.find(row => row.testCaseId === 'OQ-056');
  assert.equal(policy?.passed, true);
  assert.ok(policy?.relatedEvidence?.every(row => row.passed));
  assert.deepEqual([...active], ['foreign-session']);
});

const prerequisite = (testCaseId: string, passed = true) => ({ testCaseId, timestamp: '2026-10-02T12:00:00Z',
  method: 'POST', endpoint: baseUrl + '/api/owned', responseStatus: 200, responseBody: { success: true }, passed, notes: 'Retained native fixture result' });

for (const ids of [['PQ-030', 'PQ-031'], ['PQ-033', 'PQ-034'], ['OQ-061', 'PQ-037']])
  for (const defect of ['none', 'missing', 'failed', 'transport']) test(`combined OQ evidence requires every prerequisite ${ids.join('+')}/${defect}`, () => {
    const fixture = ownedFixture();
    fixture.results = ids.filter(id => id !== 'OQ-061').map(id => prerequisite(id));
    fixture.reasonRefusal = prerequisite('OQ-061');
    const last = fixture.results[fixture.results.length - 1];
    if (defect === 'missing') fixture.results.pop();
    if (defect === 'failed') last.passed = false;
    if (defect === 'transport') (last as any).captureError = 'Readback failed';
    assert.equal(nativeCase(fixture, ids, 'OQ-TEST').passed, defect === 'none');
  });

test('account lifecycle does not create or mutate users without explicit synthetic scope', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('No native request is authorized'); });
  const rows = await runAccountLifecycleTests(baseUrl, 'operator');
  assert.deepEqual(rows.map(row => [row.testCaseId, row.passed]), [['OQ-021', false], ['OQ-022', false]]);
});

for (const defect of ['none', 'foreign-identity', 'role-not-persisted', 'old-role-session-valid', 'fresh-role-stale',
  'viewer-still-privileged', 'disabled-session-valid', 'disabled-login-valid', 'cleanup-refused'])
  test(`owned account role/deactivation qualification retains genuine refusals and cleanup: ${defect}`, async t => {
    let user: any, version = 0, password = '', changes = 0, reads = 0;
    const sessions: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
      assert.ok(url.startsWith(baseUrl + '/api/'));
      const p = new URL(url).pathname, method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
      const bearer = new Headers(init.headers).get('authorization')?.replace('Bearer ', '');
      let status = 200, result: any = { success: true };
      if (p === '/api/users' && method === 'POST') {
        assert.match(body.username, /^oq_probe_/); assert.equal(body.role, 'viewer'); password = body.password;
        user = { userId: 77, userName: body.username, email: body.email, enabled: true, platformRole: 'viewer' };
        status = 201; result = { success: true, userId: 77 };
      } else if (p === '/api/users/77' && method === 'GET') {
        if (bearer === 'operator') { reads++; result = { success: true, data: { ...user, ...(defect === 'foreign-identity' ? { userName: 'operator' } : {}) } }; }
        else if (user.platformRole === 'viewer' && defect !== 'viewer-still-privileged') { status = 403; result = { success: false, error: { code: 'FORBIDDEN' } }; }
        else result = { success: true, data: { ...user } };
      } else if (p === '/api/users/77' && method === 'PUT') {
        assert.equal(bearer, 'operator'); assert.notEqual(defect, 'foreign-identity'); changes++;
        if (body.enabled === false && defect === 'cleanup-refused') { status = 503; result = { success: false }; }
        else { version++; if (body.role && defect !== 'role-not-persisted') user.platformRole = body.role; if (body.enabled === false) user.enabled = false; }
      } else if (p === '/api/auth/login') {
        assert.equal(body.username, user.userName); assert.equal(body.password, password);
        if (!user.enabled && defect !== 'disabled-login-valid') { status = 401; result = { success: false, message: 'User account is disabled' }; }
        else { const accessToken = `owned-session-${version}`; sessions.push(accessToken); result = { success: true, accessToken, user: { userId: 77 } }; }
      } else if (p === '/api/auth/verify') {
        const stale = bearer !== `owned-session-${version}`;
        const wronglyAccept = user.enabled ? defect === 'old-role-session-valid' : defect === 'disabled-session-valid';
        if (stale && !wronglyAccept) { status = 401; result = { success: false, error: { code: 'TOKEN_REVOKED' } }; }
        else result = { success: true, data: { userId: 77, username: user.userName,
          role: defect === 'fresh-role-stale' && user.platformRole === 'viewer' ? 'data_manager' : user.platformRole } };
      } else assert.fail(`Unexpected or foreign request ${method} ${p}`);
      return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
    });
    const rows = await runAccountLifecycleTests(baseUrl, 'operator', true);
    assert.equal(rows.every(row => row.passed), defect === 'none', rows.map(row => row.notes).join('\n'));
    assert.equal(user.enabled, defect === 'foreign-identity' || defect === 'cleanup-refused');
    if (defect === 'foreign-identity') assert.equal(changes, 0);
    if (defect === 'disabled-login-valid') assert.equal(changes, 4, 'Revoke any session unexpectedly issued after deactivation');
    assert.ok(reads > 0);
    assert.equal(JSON.stringify(rows).includes(password), false);
    for (const bearer of sessions) assert.equal(JSON.stringify(rows).includes(bearer), false);
  });

for (const defect of ['none', 'missing-headers', 'already-throttled', 'false-success', 'policy-changed', 'over-ceiling', 'never-throttled'])
  test(`rate-limit qualification follows actual quota headers and refuses false evidence: ${defect}`, async t => {
    let count = 0, username = '';
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
      assert.equal(url, baseUrl + '/api/auth/login'); count++;
      const sent = JSON.parse(String(init.body)); if (!username) username = sent.username;
      assert.equal(sent.username, username); assert.match(username, /^oq_absent_/);
      const limit = defect === 'over-ceiling' ? 501 : defect === 'policy-changed' && count > 1 ? 4 : 3;
      const throttled = defect === 'already-throttled' || count > 3 && defect !== 'never-throttled';
      return new Response(JSON.stringify({ success: defect === 'false-success', message: throttled
        ? 'Too many login attempts. Account temporarily locked. Please try again after 15 minutes.' : 'Invalid username or password' }),
      { status: throttled ? 429 : 401, headers: { 'Content-Type': 'application/json', ...(defect === 'missing-headers' ? {} : {
        'RateLimit-Limit': String(limit), 'RateLimit-Remaining': String(Math.max(0, 3 - count)), ...(throttled ? { 'Retry-After': '800' } : {}) }) } });
    });
    const result = await runRateLimitTest(baseUrl);
    assert.equal(result.passed, defect === 'none');
    assert.equal(count <= 4, true);
    if (defect === 'none') assert.equal(result.relatedEvidence?.length, 4);
  });

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

for (const defect of ['none', 'missing-prerequisite', 'failed-prerequisite', 'not-owned', 'foreign-study', 'foreign-source',
  'foreign-target', 'same-target', 'existing-history', 'invalid-proof', 'wrong-signer', 'wrong-proof-identity',
  'unrelated-refusal', 'accepted-copy', 'copy-side-effect', 'changed-source-proof', 'positive-refused',
  'wrong-positive-link', 'positive-not-retained', 'positive-changed-target', 'readback-unavailable'])
  test(`consent copy qualification requires an unchanged wrong-context refusal and same-proof positive control: ${defect}`, async t => {
    const fixture = reviewedFixture(), state = fixture.state, study = state.studyWorkspace!;
    fixture.results = ['PQ-006', 'PQ-029'].map(id => prerequisite(id));
    if (defect === 'missing-prerequisite') fixture.results.pop();
    if (defect === 'failed-prerequisite') fixture.results[0].passed = false;
    if (defect === 'not-owned') study.revision.content.execution.extensions.syntheticFixture = false;
    study.summary.entityStatus = { id: 1, label: 'available' }; study.executionContext.entityStatus = { id: 1, label: 'available' };
    study.executionContext.appliedDefinitionRevisionId = study.revision.revisionId;
    study.executionContext.appliedApplicationId = '00000000-0000-4000-8000-000000000222';
    study.executionContext.appliedExecutionConfiguration = structuredClone(study.revision.content.execution);
    state.enrollmentRequest = { studyId: 42, label: state.subjectLabel, enrollmentDate: '2026-10-02', enrollmentStatus: 'enrolled', autoScheduleVisits: false };
    const history: Record<number, any[]> = { 81: [], 82: [] };
    const target = { studySubjectId: 82, studyId: 42, label: '', enrollmentDate: '2026-10-02', enrollmentStatus: 'enrolled' };
    let signed = false, refused = false, positive = false, calls = 0, writes = 0;
    const proof = (id: number) => ({ entityType: 'consent', entityId: id,
      ...(id === 81 && signed ? { signatureId: defect === 'wrong-proof-identity' ? 501 : 500,
        isSigned: true, state: 'signed', signatureIntegrityValid: defect !== 'invalid-proof', meaning: 'approval',
        signedBy: defect === 'wrong-signer' ? 'someone-else' : 'operator', signedAt: '2026-10-02T12:00:00Z',
        contentHashAlgorithm: 'sha256', contentHash: (refused && defect === 'changed-source-proof' ? 'b' : 'a').repeat(64) }
        : { isSigned: false, state: 'unsigned' }) });
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
      calls++; const p = new URL(url).pathname, method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
      if (method !== 'GET') writes++;
      let status = 200, data: any, result: any;
      if (p === '/api/studies/42') { data = structuredClone(study); if (defect === 'foreign-study') data.summary.studyId = 99; }
      else if (p === '/api/subjects/81') data = { studySubjectId: 81, studyId: defect === 'foreign-source' ? 99 : 42,
        label: state.subjectLabel, enrollmentDate: '2026-10-02', enrollmentStatus: 'enrolled' };
      else if (p === '/api/subjects' && method === 'POST') {
        assert.equal(body.studyId, 42); assert.equal(body.autoScheduleVisits, false); target.label = body.label;
        data = { studySubjectId: defect === 'same-target' ? 81 : 82 }; status = 201;
      } else if (p === '/api/subjects/82') data = { ...target, studyId: defect === 'foreign-target' ? 99 : 42 };
      else if (p === '/api/esignature/sign') {
        assert.equal(body.entityId, 81); assert.equal(body.entityType, 'consent'); assert.equal(body.password, 'private');
        signed = true; data = { signatureId: 500 };
      } else if (/^\/api\/esignature\/status\/consent\/(81|82)$/.test(p)) data = proof(Number(p.split('/').pop()));
      else if (/^\/api\/esignature\/history\/consent\/(81|82)$/.test(p)) {
        const id = Number(p.split('/').pop()); data = id === 81 && signed ? [{ signatureId: 500, entityType: 'consent', entityId: 81, isValid: true }] : [];
      } else if (/^\/api\/consent\/subjects\/(81|82)\/consent$/.test(p)) {
        const id = Number(p.split('/')[4]);
        if (method === 'POST') {
          assert.equal(body.investigatorSignatureId, 500); assert.equal('password' in body, false); assert.equal('signaturePassword' in body, false);
          if (id === 82) {
            assert.equal(positive, false, 'Wrong-context probe must precede consumption of the valid proof'); refused = true;
            status = defect === 'unrelated-refusal' ? 404 : defect === 'accepted-copy' ? 200 : 403;
            result = { success: status === 200, message: defect === 'unrelated-refusal' ? 'Route unavailable'
              : 'The investigatorSignatureId is not a valid, unused signature for this consent subject and step' };
            if (defect === 'copy-side-effect') history[82].push({ consentId: 600, studySubjectId: 82, investigatorSignatureId: 500 });
          } else {
            assert.equal(refused, true); positive = true;
            data = { consentId: 601, studySubjectId: 81, investigatorSignatureId: defect === 'wrong-positive-link' ? 999 : 500, consentStatus: 'consented' };
            if (defect === 'positive-refused') { status = 403; result = { success: false }; }
            else if (defect !== 'positive-not-retained') history[81].push(data);
            if (defect === 'positive-changed-target') history[82].push({ consentId: 602, studySubjectId: 82 });
          }
        } else {
          data = history[id];
          if (defect === 'existing-history' && id === 81 && !signed) data = [{ consentId: 599, studySubjectId: 81 }];
          if (defect === 'readback-unavailable' && refused) { status = 503; result = { success: false }; }
        }
      } else assert.fail(`Unexpected or foreign request ${method} ${p}`);
      return new Response(JSON.stringify(result ?? { success: true, data }), { status, headers: { 'Content-Type': 'application/json' } });
    });
    const result = await captureSignatureCopyRefusal(baseUrl, 'operator', fixture);
    assert.equal(result.passed, defect === 'none', result.notes);
    assert.equal(JSON.stringify(result).includes('"private"'), false);
    if (['missing-prerequisite', 'failed-prerequisite', 'not-owned'].includes(defect)) assert.equal(calls, 0);
    if (['foreign-study', 'foreign-source', 'existing-history'].includes(defect)) assert.equal(writes, 0);
    if (defect === 'none') { assert.equal(positive, true); assert.equal(history[81].length, 1); assert.equal(history[82].length, 0); }
    if (['unrelated-refusal', 'accepted-copy', 'copy-side-effect', 'changed-source-proof', 'readback-unavailable'].includes(defect)) assert.equal(positive, false);
    assert.equal((result.relatedEvidence ?? []).some(row => ['DELETE', 'PUT', 'PATCH'].includes(row.method)), false, 'Retain native history; do not erase a failed probe');
  });

for (const defect of ['none', 'foreign-history', 'missing-unlock-audit', 'wrong-unlock-actor', 'changed-values', 'restore-refused'])
  test(`signed owned unlock retains evidence and restores only unchanged owned values: ${defect}`, async t => {
    const fixture = reviewedFixture(); fixture.results = ['PQ-033', 'PQ-034'].map(id => prerequisite(id));
    let locked = true, weight = '70.5', unlocks = 0, relocks = 0;
    const rows: any[] = [{ lockId: 701, entityType: 'event_crf', entityId: defect === 'foreign-history' ? 999 : 111,
      action: 'lock', performedBy: 7, performedAt: '2026-10-02T12:00:00Z', reason: 'Lock synthetic qualification form' }];
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
      assert.ok(url.startsWith(baseUrl + '/api/')); const p = new URL(url).pathname;
      const sent = init.body ? JSON.parse(String(init.body)) : undefined;
      let status = 200, data: any, result: any;
      if (p === '/api/auth/verify') data = { userId: 7, username: 'operator', role: 'admin' };
      else if (p === '/api/forms/data/111') data = { ...nativeForm(weight), lockStatus: { locked, frozen: false } };
      else if (p === '/api/data-locks/history/111') data = rows;
      else if (p === '/api/data-locks/111/unlock') {
        assert.equal(init.method, 'POST'); assert.equal(sent.signaturePassword, 'private'); assert.match(sent.reason, /^Owned OQ unlock /);
        unlocks++; locked = false; if (defect === 'changed-values') weight = '95';
        if (defect !== 'missing-unlock-audit') rows.push({ lockId: 702, entityType: 'event_crf', entityId: 111,
          action: 'unlock', performedBy: defect === 'wrong-unlock-actor' ? 8 : 7, performedAt: '2026-10-02T12:01:00Z', reason: sent.reason });
      } else if (p === '/api/data-locks') {
        assert.equal(init.method, 'POST'); assert.equal(sent.eventCrfId, 111); assert.equal(sent.signaturePassword, 'private'); relocks++;
        if (defect === 'restore-refused') { status = 503; result = { success: false }; } else locked = true;
      } else assert.fail(`Unexpected native path ${p}`);
      return new Response(JSON.stringify(result ?? { success: true, ...(data === undefined ? {} : { data }) }), { status, headers: { 'Content-Type': 'application/json' } });
    });
    const result = await captureOwnedUnlock(baseUrl, 'operator', fixture);
    assert.equal(result.passed, defect === 'none', result.notes);
    assert.equal(unlocks, defect === 'foreign-history' ? 0 : 1);
    assert.equal(relocks, ['foreign-history', 'changed-values'].includes(defect) ? 0 : 1);
    assert.equal(locked, !['changed-values', 'restore-refused'].includes(defect));
    assert.equal(JSON.stringify(result).includes('"private"'), false);
    if (defect === 'restore-refused') assert.match(result.notes, /Restoration also failed/);
  });

for (const defect of ['none', 'missing-freeze-reason', 'missing-action', 'foreign', 'wrong-actor', 'bad-time', 'failed-prerequisite'])
  test(`lifecycle audit proves each exact governed operation including required freeze reason: ${defect}`, async t => {
    const fixture = reviewedFixture(); fixture.results = ['PQ-030', 'PQ-032', 'PQ-033'].map(id => prerequisite(id));
    if (defect === 'failed-prerequisite') fixture.results[0].passed = false;
    const rows = ['freeze', 'unfreeze', 'lock'].map((action, i) => ({ lockId: 701 + i, entityType: 'event_crf',
      entityId: defect === 'foreign' ? 999 : 111, action, performedBy: defect === 'wrong-actor' ? 99 : 7,
      performedAt: defect === 'bad-time' ? 'not-a-time' : '2026-10-02T12:00:00Z',
      reason: defect === 'missing-freeze-reason' && action === 'freeze' ? undefined : `${action[0].toUpperCase() + action.slice(1)} synthetic qualification form` }));
    if (defect === 'missing-action') rows.pop();
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      const p = new URL(url).pathname;
      assert.ok(['/api/forms/data/111', '/api/auth/verify', '/api/data-locks/history/111'].includes(p));
      return new Response(JSON.stringify({ success: true, data: p === '/api/forms/data/111' ? nativeForm()
        : p === '/api/auth/verify' ? { userId: 7, username: 'operator' } : rows }), { headers: { 'Content-Type': 'application/json' } });
    });
    assert.equal((await captureLifecycleAudit(baseUrl, 'operator', fixture)).passed, defect === 'none');
  });

for (const defect of ['none', 'missing-old', 'wrong-scope', 'wrong-actor', 'wrong-old-actor', 'wrong-hash', 'duplicate', 'missing-prerequisite'])
  test(`signature audit links both real workflow signatures to their exact manifest: ${defect}`, async t => {
    const fixture = reviewedFixture(); fixture.state.signatureId = 222;
    fixture.results = ['PQ-027', 'PQ-029'].map((id, i) => ({ ...prerequisite(id), relatedEvidence: [{ ...prerequisite(id + '-sign'),
      endpoint: baseUrl + '/api/esignature/sign', responseBody: { success: true, data: { signatureId: 221 + i } } }] }));
    if (defect === 'missing-prerequisite') fixture.results.pop();
    const contentHash = 'a'.repeat(64), signedAt = '2026-10-02T12:00:00Z';
    const rows = [221, 222].map(auditId => ({ auditId, userId: defect === 'wrong-actor' || defect === 'wrong-old-actor' && auditId === 221 ? 8 : 7,
      studyId: 42, eventCrfId: defect === 'wrong-scope' ? 999 : 111, studyEventId: 91, auditDate: signedAt,
      newValue: JSON.stringify({ type: 'electronic_signature', entity_type: 'event_crf', entity_id: 111, signed_by: 'operator',
        meaning: 'approval', signed_at: signedAt, content_hash: defect === 'wrong-hash' ? 'b'.repeat(64) : contentHash, hash_algorithm: 'sha256' }) }));
    if (defect === 'missing-old') rows.shift(); if (defect === 'duplicate') rows.push(rows[0]);
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      const p = new URL(url).pathname;
      assert.ok(['/api/forms/data/111', '/api/esignature/status/eventCrf/111', '/api/audit/form/111'].includes(p));
      return new Response(JSON.stringify({ success: true, data: p === '/api/forms/data/111' ? nativeForm()
        : p === '/api/audit/form/111' ? rows : { contract: 'edc-event-crf-signature-proof/1', entityId: 111, studyId: 42,
          studySubjectId: 81, studyEventId: 91, isSigned: true, signatureIntegrityValid: true,
          activeSignature: { signatureId: 222, signerUserId: 7, signedAt, contentHash } } }), { headers: { 'Content-Type': 'application/json' } });
    });
    assert.equal((await captureSignatureAudit(baseUrl, 'operator', fixture)).passed, defect === 'none');
  });
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

for (const defect of ['none', 'signed', 'signed-legacy', 'json', 'fake-envelope', 'empty', 'foreign-source', 'foreign-print', 'foreign-proof',
  'missing-field', 'wrong-value', 'wrong-unit', 'duplicate-field', 'wrong-pdf-value', 'audit-missing', 'audit-foreign',
  'audit-wrong-actor', 'audit-wrong-item', 'audit-wrong-visit', 'audit-no-actor-id', 'audit-duplicate',
  'signer-missing-name', 'signer-missing-username', 'signer-no-id', 'signer-empty-meaning', 'signer-unverified',
  'signer-wrong-algorithm', 'signer-wrong-scope', 'print-proof-missing', 'print-proof-actor-mismatch', 'proof-no-required', 'proof-foreign-entity',
  ...['contract', 'entityType', 'entityId', 'studyId', 'studySubjectId', 'studyEventId', 'crfVersionId', 'isSigned',
    'signatureRequired', 'state', 'integrityStatus', 'signatureIntegrityValid', 'signatureIntegrityReason', 'activeSignature',
    'contentHashAlgorithm'].map(key => `projection-${key}`),
  'false-signed', 'source-changed', 'proof-changed'])
test(`PDF download parses owned content, audit and current proof: ${defect}`, async t => {
  const fixture = reviewedFixture();
  Object.assign(fixture.state, { formItems: { weight: 103, notes: 104 },
    values: { weight: '70.5', notes: 'Synthetic software qualification only' } });
  let reads = 0, proofReads = 0, downloaded = false;
  const signature: any = { signatureId: 901, signerUserId: 77, signedBy: 'operator', signedByFullName: 'Owned Operator', signerUsername: 'operator',
    hashAlgorithm: 'sha256', hashScope: defect === 'signed-legacy' ? null : 'entity',
    signedAt: '2026-10-02T12:00:00.000Z', meaning: 'Approved', contentHash: 'a'.repeat(64), signatureScope: 'event-crf-item-values/1' };
  const proof: any = { contract: 'edc-event-crf-signature-proof/1', entityType: 'event_crf', entityId: 111, studyId: 42,
    studySubjectId: 81, studyEventId: 91, crfVersionId: 72, state: 'unsigned', isSigned: false,
    signatureIntegrityValid: false, integrityStatus: 'unsigned', signatureRequired: true,
    signatureIntegrityReason: 'No signature found for this form', activeSignature: null };
  const signed = ['signed', 'signed-legacy', 'false-signed', 'print-proof-actor-mismatch'].includes(defect) || defect.startsWith('signer-');
  if (signed) Object.assign(proof, { state: 'signed', isSigned: true, signatureIntegrityValid: true, integrityStatus: 'verified',
    signatureIntegrityReason: null, contentHashAlgorithm: 'sha256', activeSignature: signature,
    signedAt: signature.signedAt, signedBy: signature.signedBy, signedByFullName: signature.signedByFullName,
    meaning: signature.meaning, contentHash: signature.contentHash });
  if (defect === 'signer-missing-name') delete signature.signedByFullName;
  if (defect === 'signer-missing-username') delete signature.signerUsername;
  if (defect === 'signer-no-id') delete signature.signerUserId;
  if (defect === 'signer-empty-meaning') signature.meaning = ' ';
  if (defect === 'signer-unverified') proof.integrityStatus = 'unverified';
  if (defect === 'signer-wrong-algorithm') signature.hashAlgorithm = 'md5';
  if (defect === 'signer-wrong-scope') signature.hashScope = 'casebook';
  if (defect === 'proof-no-required') delete proof.signatureRequired;
  if (defect === 'proof-foreign-entity') proof.entityType = 'study_subject';
  if (defect === 'foreign-proof') proof.studyId = 999;
  const fields: any[] = [
    { fieldId: 103, name: 'weight', label: 'Weight', type: 'number', value: '70.5', displayValue: '70.5', unit: 'kg' },
    { fieldId: 104, name: 'notes', label: 'Notes', type: 'text', value: 'Synthetic software qualification only', displayValue: 'Synthetic software qualification only' },
  ];
  if (defect === 'missing-field') fields.pop();
  if (defect === 'duplicate-field') fields[1] = fields[0];
  if (defect === 'wrong-value') fields[0].value = '71.5';
  if (defect === 'wrong-unit') fields[0].unit = 'lb';
  let bytes = defect === 'json' ? Buffer.from('{"success":true}')
    : defect === 'fake-envelope' ? Buffer.from('%PDF-1.7\nnot a PDF document\n%%EOF\n')
    : readFileSync(path.join(__dirname, 'fixtures/pdf', defect === 'empty' ? 'empty-text.pdf' : signed && defect !== 'false-signed' ? 'signed-form.pdf' : 'owned-form.pdf'));
  if (defect === 'wrong-pdf-value') {
    const changed = Buffer.from(bytes.toString('latin1').replace(/70\.5/g, '71.5'), 'latin1');
    assert.notDeepEqual(changed, bytes, 'The positive fixture must actually be changed.'); bytes = changed;
  }
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const u = new URL(url); let data: any;
    if (u.pathname === '/api/forms/data/111') {
      data = nativeForm(defect === 'source-changed' && ++reads > 1 ? '71.5' : '70.5');
      data.formData.item_104 = 'Synthetic software qualification only';
      if (defect === 'foreign-source') data.studySubjectId = 999;
    } else if (u.pathname === '/api/print/forms/111/data') {
      // Canonical print proof contains signer aliases the status HTTP DTO omits.
      const printProof: any = { ...proof, ...(signed ? signature : {}) };
      if (defect === 'print-proof-missing') delete printProof.signatureRequired;
      if (defect === 'print-proof-actor-mismatch') printProof.activeSignature = { ...signature, signerUserId: 99 };
      if (defect.startsWith('projection-')) {
        const key = defect.slice('projection-'.length), value = printProof[key];
        printProof[key] = typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1 : 'different';
      }
      data = { formId: defect === 'foreign-print' ? 222 : 111, subjectLabel: fixture.state.subjectLabel,
        sections: [{ fields }], signatureProof: printProof };
    } else if (u.pathname === '/api/esignature/status/event_crf/111') {
      data = defect === 'proof-changed' && ++proofReads > 1 ? { ...proof, state: 'invalidated' } : proof;
    } else if (u.pathname === '/api/audit/form/111') {
      data = defect === 'audit-missing' ? [] : [{ auditId: 801, entityId: 1103, eventCrfId: 111,
        itemId: defect === 'audit-wrong-item' ? 104 : 103, studyEventId: defect === 'audit-wrong-visit' ? 999 : 91,
        ...(defect === 'audit-no-actor-id' ? {} : { userId: 77 }),
        studyId: defect === 'audit-foreign' ? 999 : 42, entityName: 'Weight', userName: 'operator',
        userFullName: defect === 'audit-wrong-actor' ? 'Foreign Operator' : 'Owned Operator',
        oldValue: '75', newValue: '70.5', reasonForChange: 'PQ verified synthetic weight correction' }];
      if (defect === 'audit-duplicate') data.push({ ...data[0], auditId: 802 });
    } else {
      assert.equal(u.pathname, '/api/print/forms/111/pdf');
      assert.deepEqual([...u.searchParams], [['outputFormat', 'pdf'], ['includeAuditTrail', 'true'], ['includeSignatures', 'true']]);
      downloaded = true;
      return new Response(bytes, { headers: { 'Content-Type': defect === 'json' ? 'application/json' : 'application/pdf' } });
    }
    return new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } });
  });
  const result = await captureNativeDownload('OQ-048', baseUrl, 'operator', 'pdf', fixture);
  assert.equal(result.passed, ['none', 'signed', 'signed-legacy'].includes(defect), result.notes);
  if (downloaded) {
    const body = result.responseBody as any;
    assert.equal(body.byteLength, bytes.length); assert.equal(body.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(Buffer.from(body.content, 'base64'), bytes);
  }
  if (result.passed) assert.ok(result.relatedEvidence?.some(row => row.testCaseId === 'OQ-048-parsed-content' && row.passed));
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
  // The runner has no built-in operator: name a synthetic one (login itself is mocked below).
  const saved = { username: process.env.OQ_USERNAME, password: process.env.OQ_PASSWORD };
  t.after(() => {
    if (saved.username === undefined) delete process.env.OQ_USERNAME; else process.env.OQ_USERNAME = saved.username;
    if (saved.password === undefined) delete process.env.OQ_PASSWORD; else process.env.OQ_PASSWORD = saved.password;
  });
  process.env.OQ_USERNAME = 'synthetic-oq-operator';
  process.env.OQ_PASSWORD = 'synthetic-oq-secret';
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
  assert.equal(calls.at(-1), 'POST /api/auth/login', 'Quota probe runs only after all cleanup and logout');
  assert.equal(calls.at(-2), 'POST /api/auth/logout');
  assert.equal(results.find((row: any) => row.testCaseId === 'OQ-NATIVE-RETENTION').relatedEvidence.find((row: any) => row.testCaseId === 'PQ-040').passed, true);
});

for (const defect of ['missing-role', 'bad-id', 'bad-exp', 'valid']) test(`JWT case requires real numeric identity, role and finite future expiry: ${defect}`, async t => {
  const payload: any = { userId: 7, role: 'admin', exp: Date.now()/1000+600 };
  if (defect === 'missing-role') delete payload.role;
  if (defect === 'bad-id') payload.userId = '7';
  if (defect === 'bad-exp') payload.exp = 'far-future';
  const token = `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fixture`;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const route = new URL(url).pathname;
    const body = route === '/api/auth/login' ? { success: true, accessToken: token }
      : route === '/api/auth/logout' ? { success: true }
      : { success: false, error: { code: 'SESSION_REVOKED' } };
    return new Response(JSON.stringify(body), { status: route === '/api/auth/verify' ? 401 : 200,
      headers: { 'Content-Type': 'application/json' } });
  });
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
