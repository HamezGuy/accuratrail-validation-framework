import test from 'node:test';
import assert from 'node:assert/strict';
import { runComprehensiveRbacTests, runDeepDataOperationTests } from '../runners/oq-runner';
import { runStudySetup } from '../runners/pq-runner';
import { workspace } from './study-contract-fixtures';
import { cloneStudy, type StudyWorkspace } from '../runners/study-definition-client';

function fakeApi(t: any, options: { createStatus?: number; corruptLastRead?: boolean } = {}) {
  let current: StudyWorkspace | undefined, reads = 0;
  const calls: Array<{ path: string; method: string; body?: any }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit = {}) => {
    assert.ok(String(url).startsWith('https://qualification.invalid/'), 'Only in-memory qualification transport is allowed');
    const path = new URL(url).pathname;
    const method = request.method ?? 'GET', body = request.body ? JSON.parse(String(request.body)) : undefined;
    calls.push({ path, method, body });
    let status = 200, result: any = { success: false };
    if (path === '/api/studies' && method === 'POST') {
      status = options.createStatus ?? 201;
      if (status === 201) { current = workspace(body.content); result = { success: true, data: current }; }
    } else if (path === '/api/studies' && method === 'GET') {
      result = { success: true, data: { studies: current ? [current.summary] : [], total: current ? 1 : 0, page: 1, pageSize: 100 } };
    } else if (path === '/api/studies/42' && method === 'PUT') {
      assert.equal(body.baseRevisionToken, current!.revision.revisionToken);
      current = workspace(body.content, 42, current!.revision.revisionNumber + 1);
      result = { success: true, data: current };
    } else if (path === '/api/studies/42/execution' && method === 'PUT') {
      assert.equal(body.baseRevisionToken, current!.revision.revisionToken);
      current = workspace(current!.revision.content, 42, current!.revision.revisionNumber + 1);
      current.executionContext.visits = body.visits.upsert.map((visit: any) => ({ ...visit, studyEventDefinitionId: 901 }));
      result = { success: true, data: current };
    } else if (path === '/api/studies/42' && method === 'GET') {
      reads++;
      const returned = cloneStudy(current!);
      if (options.corruptLastRead && reads === 3) returned.revision.content.execution.extensions.lostData = true;
      result = { success: true, data: returned };
    } else { status = 400; }
    return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

test('OQ-097 exercises canonical create plus exact readback, not endpoint existence', async t => {
  const calls = fakeApi(t);
  const results = await runComprehensiveRbacTests('https://qualification.invalid', 'synthetic-token');
  const created = results.find(result => result.testCaseId === 'OQ-097')!;
  assert.equal(created.passed, true);
  assert.equal(created.relatedEvidence!.length, 2);
  assert.equal(calls.find(call => call.path === '/api/studies' && call.method === 'POST')!.body.content.contract, 'edc-study-definition/1');
  assert.equal(JSON.stringify(created).includes('synthetic-token'), false);
});
for (const createStatus of [400, 500]) {
  test(`OQ-097/153 cannot pass a rejected HTTP ${createStatus} create; OQ-155 remains blocked`, async t => {
    fakeApi(t, { createStatus });
    const rbac = await runComprehensiveRbacTests('https://qualification.invalid', 'synthetic-token');
    const deep = await runDeepDataOperationTests('https://qualification.invalid', 'synthetic-token');
    assert.equal(rbac.find(result => result.testCaseId === 'OQ-097')!.passed, false);
    assert.equal(deep.find(result => result.testCaseId === 'OQ-153')!.passed, false);
    assert.equal(deep.find(result => result.testCaseId === 'OQ-155')!.passed, false);
  });
}
test('OQ-155 detects a mismatched graph despite HTTP 200 and a valid numeric ID', async t => {
  const calls = fakeApi(t, { corruptLastRead: true });
  const results = await runDeepDataOperationTests('https://qualification.invalid', 'synthetic-token');
  assert.equal(results.find(result => result.testCaseId === 'OQ-153')!.passed, true);
  assert.equal(results.find(result => result.testCaseId === 'OQ-155')!.passed, false);
  assert.equal(calls.some(call => call.path === '/api/subjects' && call.method === 'POST'), false);
});
test('PQ study setup updates document.study.description and revision-aware native visits', async t => {
  const calls = fakeApi(t);
  const state: any = { adminToken: 'synthetic-token', studyId: null, studyName: '', orgId: 10 };
  const results = await runStudySetup('https://qualification.invalid', state);
  for (const id of ['PQ-001', 'PQ-002', 'PQ-003', 'PQ-004']) assert.equal(results.find(result => result.testCaseId === id)!.passed, true, id);
  assert.equal(state.studyId, 42); assert.equal(state.eventDefinitionId, 901);
  const update = calls.find(call => call.method === 'PUT' && call.path === '/api/studies/42')!;
  assert.match(update.body.content.document.study.description, /UPDATED/);
  assert.equal('description' in update.body, false);
  assert.equal(calls.some(call => call.path === '/api/events/definitions'), false);
  assert.equal(calls.some(call => call.path === '/api/subjects' && call.method === 'POST'), false);
  assert.equal(results.find(result => result.testCaseId === 'PQ-006')!.passed, false);
});

// Full workflow responses model the current native wire contracts; they are
// transport fixtures, never a claim of official USDM or clinical qualification.
for (const runner of ['pq', 'oq']) for (const defect of [undefined, 'activation-rejected', 'field-loss', 'subject-mismatch', 'missing-date', 'wrong-date', 'stale-review']) {
test(`explicit ${runner.toUpperCase()} qualification binds native activation and enrollment: ${defect ?? 'valid'}`, async t => {
  const { activationSnapshot } = await import('./activation-review-fixtures');
  let current: StudyWorkspace | undefined, released: StudyWorkspace['revision'] | undefined;
  let subject: any, visit: any, fields: any[] = [];
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit = {}) => {
    assert.ok(String(url).startsWith('http://localhost:39999/'));
    const route = new URL(url), method = request.method ?? 'GET';
    const body = request.body ? JSON.parse(String(request.body)) : undefined;
    paths.push(`${method} ${route.pathname}`);
    let status = 200, data: any, result: any;
    const bump = () => {
      const next = workspace(current!.revision.content, 42, current!.revision.revisionNumber + 1);
      next.executionContext = cloneStudy(current!.executionContext); current = next;
    };
    if (route.pathname === '/api/studies' && method === 'POST') { current = workspace(body.content); data = current; status = 201; }
    else if (route.pathname === '/api/studies' && method === 'GET') data = { studies: [current!.summary], total: 1, page: 1, pageSize: 100 };
    else if (route.pathname === '/api/studies/42' && method === 'PUT') { bump(); current!.revision.content = body.content; data = current; }
    else if (route.pathname === '/api/studies/42/execution') { bump(); current!.executionContext.visits = body.visits.upsert.map((v: any) => ({ ...v, studyEventDefinitionId: 901 })); data = current; }
    else if (route.pathname === '/api/forms' && method === 'POST') { fields = body.fields.map((f: any, i: number) => ({ ...f, itemId: 100 + i })); result = { success: true, crfId: 71 }; status = 201; }
    else if (route.pathname === '/api/forms/71/metadata') data = { crf: { crfId: 71, sourceStudyId: 42 }, version: { crfVersionId: 72 }, items: defect === 'field-loss' ? fields.map(f => f.name === 'weight' ? { ...f, min: undefined } : f) : fields };
    else if (route.pathname === '/api/studies/42/definition/release') { bump(); current!.revision.state = 'released'; current!.revision.validation.releaseReady = true; current!.revision.manifestHash = `sha256:${'a'.repeat(64)}`; released = cloneStudy(current!.revision); data = current; }
    else if (route.pathname === '/api/studies/42/definition/apply') { bump(); current!.executionContext.appliedDefinitionRevisionId = released!.revisionId; current!.executionContext.appliedApplicationId = '00000000-0000-4000-8000-000000000777'; current!.executionContext.appliedExecutionConfiguration = cloneStudy(released!.content.execution); data = current; }
    else if (route.pathname === '/api/studies/42/activation-review') data = activationSnapshot(current!, released);
    else if (route.pathname === '/api/forms/import-study-bundle/42/activate') { assert.equal(body.acknowledgeUngoverned, true); if (defect === 'activation-rejected') { status = 500; result = { success: false }; } current!.summary.entityStatus = current!.executionContext.entityStatus = { id: 1, label: 'available' }; data = {}; }
    else if (route.pathname === '/api/studies/42' && method === 'GET') data = current;
    else if (route.pathname === '/api/subjects' && method === 'POST') {
      assert.equal(current!.executionContext.entityStatus.id, 1);
      assert.equal(body.autoScheduleVisits, false); assert.equal(body.status, undefined);
      if (subject) { status = 400; result = { success: false, message: 'Subject already exists in this study.' }; }
      else { subject = { studySubjectId: 81, studyId: 42, label: body.label, enrollmentStatus: body.enrollmentStatus, enrollmentDate: defect === 'missing-date' ? undefined : defect === 'wrong-date' ? '1900-01-01' : body.enrollmentDate }; data = subject; status = 201; }
    } else if (route.pathname === '/api/subjects/81') data = defect === 'subject-mismatch' ? { ...subject, studyId: 999 } : subject;
    else if (route.pathname === '/api/subjects' && method === 'GET') result = { success: true, data: [subject], pagination: { total: 1 } };
    else if (route.pathname === '/api/events/schedule') { assert.equal(body.studySubjectId, 81); visit = { ...body, studyEventId: 91, dateStart: null }; data = { studyEventId: 91 }; status = 201; }
    else if (route.pathname === '/api/events/subject/81') data = [visit];
    else throw new Error(`Unexpected native contract ${method} ${route.pathname}`);
    return new Response(JSON.stringify(result ?? { success: true, data }), { status, headers: { 'Content-Type': 'application/json' } });
  });
  const state: any = { adminToken: 'synthetic-token', studyId: null, studyName: '', orgId: 10 };
  const qualification = { username: 'synthetic-operator', password: 'synthetic-password',
    reason: 'Approve synthetic qualification', acknowledgeUngoverned: true,
    ...(defect === 'stale-review' ? { activationReviewHash: `sha256:${'0'.repeat(64)}` } : {}) };
  const results = runner === 'pq' ? await runStudySetup('http://localhost:39999', state, qualification)
    : await runDeepDataOperationTests('http://localhost:39999', 'synthetic-token', qualification);
  if (runner === 'oq') {
    const enrollment = results.find(row => row.testCaseId === 'OQ-154')!;
    assert.equal(enrollment.passed, !defect, enrollment.notes);
    assert.equal(enrollment.relatedEvidence?.length, 10);
    assert.equal(paths.filter(path => path === 'POST /api/studies').length, 1, 'OQ must reuse its own setup fixture');
    if (defect && !['subject-mismatch', 'missing-date', 'wrong-date'].includes(defect)) assert.equal(paths.includes('POST /api/subjects'), false);
    assert.equal(JSON.stringify(enrollment).includes('synthetic-password'), false);
    return;
  }
  if (defect) {
    assert.equal(results.find(r => r.testCaseId === (['subject-mismatch', 'missing-date', 'wrong-date'].includes(defect) ? 'PQ-006' : 'PQ-005'))!.passed, false);
    assert.equal(results.find(r => r.testCaseId === 'PQ-010')!.passed, false);
    if (!['subject-mismatch', 'missing-date', 'wrong-date'].includes(defect)) assert.equal(paths.includes('POST /api/subjects'), false);
    return;
  }
  for (const row of results) assert.equal(row.passed, true, `${row.testCaseId}: ${row.notes}`);
  assert.equal(results.length, 10); assert.equal(state.subjectId, 81); assert.equal(state.visitId, 91);
  assert.equal(paths.filter(path => path === 'POST /api/subjects').length, 2);
  assert.ok(paths.indexOf('POST /api/forms/import-study-bundle/42/activate') < paths.indexOf('POST /api/subjects'));
  assert.equal(paths.some(path => path === 'POST /api/events'), false);
  assert.equal(JSON.stringify(results).includes('synthetic-password'), false);
});

}
