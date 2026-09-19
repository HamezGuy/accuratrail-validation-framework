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
