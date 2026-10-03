import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SIGNATURE_MEANINGS } from '@accura-trial/shared-types';
import { createWorkflowState, runDataEntry, runReviewAndSignature, runCleanupVerification } from '../runners/pq-runner';
import { syntheticStudyDefinition } from '../runners/qualification-fixture';
import { workspace } from './study-contract-fixtures';

// Offline transport regressions. These fixtures exercise qualification evidence
// handling; they do not constitute execution against a native EDC or CORE.
function workflow(t: any, defect?: string) {
  const baseUrl = 'https://qualification.invalid';
  const state = Object.assign(createWorkflowState(baseUrl, 'private-token'), {
    studyId: 42, subjectId: 81, visitId: 91, formId: 71, crfVersionId: 72,
    formItems: { patientInitials: 101, dateOfBirth: 102, weight: 103, gender: 104, notes: 105 },
    qualification: { username: 'synthetic-operator', password: 'private-password', reason: 'Synthetic qualification' },
    studyWorkspace: workspace(syntheticStudyDefinition('PQ-CONTRACT')),
  });
  const values: Record<string, string> = {}, audit: any[] = [], calls: any[] = [];
  let revision = 1, complete = false, everCompleted = false, frozen = false, locked = false, queryState = 1, active: any = null, signId = 300;
  const hash = () => `sha256:${createHash('sha256').update(JSON.stringify({ values, revision, complete, frozen, locked })).digest('hex')}`;
  const read = () => ({ eventCrfId: 111, studyId: defect === 'wrong-study' ? 999 : 42,
    studySubjectId: 81, studyEventId: 91, crfId: 71, crfVersionId: 72,
    execution: null, observationPreconditionContract: 'edc-form-observation-preconditions/1', observationSnapshotHash: hash(),
    formData: { ...values }, data: Object.entries(values).map(([key, value]) => ({ itemId: Number(key.slice(5)), itemDataId: Number(key.slice(5)) + 1000, value })),
    lockStatus: { locked, frozen, signed: !!active, isComplete: complete } });
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    assert.ok(String(url).startsWith(baseUrl + '/api/'), 'No live network in contract tests');
    const path = new URL(url).pathname, method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    let status = 200, result: any = { success: true, data: {} };
    const data = (value: any) => { result = { success: true, data: value }; };
    if (path === '/api/events/instance/91/crfs') data([{ crfId: 71, crfVersionId: 72, studyEventId: 91, studySubjectId: 81, eventCrfId: 111 }]);
    else if (path === '/api/forms/data/111') data(read());
    else if (path === '/api/forms/save') {
      assert.equal(method, 'POST'); assert.equal(body.eventCrfId, 111); assert.equal(body.subjectId, 81);
      assert.equal(body.studyId, 42); assert.equal(body.crfId, 71); assert.equal(body.studyEventId, 91);
      assert.equal(body.submitAction, 'draft'); assert.ok(body.reasonForChange.length >= 10);
      assert.equal(body.expectedObservations.contract, 'edc-form-observation-preconditions/1');
      assert.equal(body.expectedExecution, undefined, 'Nullable execution must be omitted for save schema');
      if (frozen || locked) {
        status = defect === 'wrong-lock-refusal' ? 403 : 423;
        result = { success: false, code: defect === 'wrong-lock-refusal' ? 'FORBIDDEN' : 'DATA_LOCKED', lockLevel: 'form',
          message: `This form is ${locked ? 'locked' : 'frozen'} and cannot be modified` };
      }
      else if (body.expectedObservations.snapshotHash !== hash() && defect !== 'accept-stale') {
        status = defect === 'stale-server-error' ? 500 : 409;
        result = { success: false, code: 'STUDY_FORM_OBSERVATION_STALE' };
        if (defect === 'mutate-rejected') { values.item_103 = '99'; revision++; }
      } else {
        for (const [key, value] of Object.entries(body.formData)) {
          assert.match(key, /^item_10[1-5]$/);
          if (defect === 'drop-value' && key === 'item_102') continue;
          audit.push({ eventCrfId: 111, studyId: 42, studyEventId: 91, itemId: Number(key.slice(5)), userId: 7,
            oldValue: values[key] ?? null, newValue: String(value ?? ''), reasonForChange: body.reasonForChange, auditDate: '2026-10-02T12:00:00Z' });
          values[key] = String(value ?? '');
        }
        if (defect !== 'retain-signature') active = null;
        complete = false;
        revision++;
      }
    } else if (path === '/api/forms/validate-field/111') {
      assert.equal(body.fieldName, 'item_103'); assert.equal(body.createQueries, false);
      result = { success: false, data: { valid: false, errors: [{ fieldPath: 'item_103', message: 'Minimum 0', severity: 'error' }] } };
      if (defect === 'preview-mutation') revision++;
    } else if (path === '/api/queries/form/111') data([]);
    else if (path === '/api/queries' && method === 'POST') {
      assert.equal(body.entityType, 'itemData'); assert.equal(body.entityId, 1103); assert.equal(body.eventCrfId, 111);
      status = 201; result = { success: true, queryId: 201, data: { queryId: 201 } };
    } else if (path === '/api/queries/201/respond') { assert.equal(body.newStatusId, 3); queryState = 3; }
    else if (path === '/api/queries/201/close-with-signature') { assert.equal(body.signaturePassword, 'private-password'); queryState = 4; }
    else if (path === '/api/queries/201') data({ discrepancyNoteId: 201, studyId: 42, entityType: 'itemData', resolutionStatusId: queryState,
      linkedItemData: { itemDataId: 1103, itemId: 103, eventCrfId: 111 } });
    else if (path === '/api/forms/111/complete') {
      assert.equal(body.expectedExecution, null); assert.equal(body.expectedObservations.snapshotHash, hash());
      const signed = body.signatureUsername !== undefined;
      if (everCompleted && !signed) { status = 403; result = { success: false, code: 'SIGNATURE_REQUIRED', commitStatus: 'not_committed' }; }
      else {
        if (signed) {
          assert.equal(body.signatureUsername, 'synthetic-operator'); assert.equal(body.signaturePassword, 'private-password');
          active = { signatureId: ++signId, signerUsername: body.signatureUsername, meaning: SIGNATURE_MEANINGS.FORM_DATA_COMPLETE,
            signedAt: '2026-10-02T12:00:00Z', contentHash: createHash('sha256').update(JSON.stringify(values)).digest('hex') };
        }
        complete = true; everCompleted = true; revision++;
      }
    } else if (path === '/api/sdv/111/verify') assert.equal(method, 'PUT');
    else if (path === '/api/sdv/111') data({ eventCrfId: 111, studySubjectId: 81, sdvStatus: true, sdvUpdateId: 7 });
    else if (path === '/api/esignature/sign') assert.fail('A signed re-completion is the form signature; the API refuses a second one (FORM_ALREADY_SIGNED).'); else if (path === '/api/esignature/status/eventCrf/111') data({ contract: 'edc-event-crf-signature-proof/1', entityId: 111,
      studyId: 42, studySubjectId: 81, studyEventId: 91, isSigned: !!active, signatureIntegrityValid: defect === 'unverified-signature' ? false : !!active,
      integrityStatus: active ? 'verified' : 'unsigned', activeSignature: active });
    else if (path === '/api/data-locks/freeze/111') { assert.equal(body.signaturePassword, 'private-password'); frozen = true; revision++; }
    else if (path === '/api/data-locks/freeze/111/unfreeze') { frozen = false; revision++; }
    else if (path === '/api/data-locks') { assert.equal(body.eventCrfId, 111); locked = true; revision++; }
    else if (path === '/api/data-cuts/raw-store-snapshot') data({ schemaVersion: 'edc-raw-store-snapshot/1', studyId: 42,
      scope: { complete: defect !== 'incomplete-export', nativeStudyId: 42 },
      tables: [{ table: 'item_data', count: Object.keys(values).length, rows: Object.entries(values).map(([key, value]) => ({
        nativeJson: JSON.stringify({ event_crf_id: 111, item_id: Number(key.slice(5)), value: defect === 'wrong-export' ? 'wrong' : value, deleted: false }),
      })) }] });
    else if (path === '/api/audit/form/111') data(defect === 'missing-audit-values' ? audit.map(row => ({ ...row, oldValue: undefined, newValue: undefined })) : audit);
    else if (path === '/api/studies/42' && method === 'DELETE') { state.studyWorkspace.executionContext.entityStatus = { id: 5, label: 'removed' }; }
    else if (path === '/api/studies/42') data(state.studyWorkspace);
    else assert.fail(`Unexpected native request: ${method} ${path}`);
    return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return { state, calls, baseUrl };
}

test('PQ native data, review and retention steps preserve exact values, identities, signatures and audit evidence', async t => {
  const { state, calls, baseUrl } = workflow(t);
  const results = [...await runDataEntry(baseUrl, state), ...await runReviewAndSignature(baseUrl, state), ...await runCleanupVerification(baseUrl, state)];
  assert.equal(results.length, 30);
  for (const result of results) assert.equal(result.passed, true, `${result.testCaseId}: ${result.notes}`);
  assert.equal(new Set(results.map(row => row.testCaseId)).size, 30);
  assert.equal(JSON.stringify(results).includes('private-password'), false); assert.equal(JSON.stringify(results).includes('private-token'), false);
  assert.ok(calls.some(call => call.method === 'DELETE' && call.path === '/api/studies/42'));
});
for (const [defect, failedId] of [
  ['wrong-study', 'PQ-011'], ['drop-value', 'PQ-011'], ['preview-mutation', 'PQ-014'],
  ['accept-stale', 'PQ-022'], ['stale-server-error', 'PQ-022'], ['mutate-rejected', 'PQ-022'],
  ['unverified-signature', 'PQ-027'], ['retain-signature', 'PQ-029'], ['wrong-lock-refusal', 'PQ-031'],
  ['incomplete-export', 'PQ-035'], ['wrong-export', 'PQ-035'], ['missing-audit-values', 'PQ-037'],
]) test(`PQ refuses passing evidence for ${defect}`, async t => {
  const { state, baseUrl } = workflow(t, defect);
  const results = [...await runDataEntry(baseUrl, state), ...await runReviewAndSignature(baseUrl, state), ...await runCleanupVerification(baseUrl, state)];
  assert.equal(results.find(row => row.testCaseId === failedId)?.passed, false);
  assert.ok(results.find(row => row.testCaseId === failedId)?.relatedEvidence?.length);
});

test('PQ archive refuses an unowned study and does not issue DELETE', async t => {
  const { state, calls, baseUrl } = workflow(t);
  await runDataEntry(baseUrl, state); await runReviewAndSignature(baseUrl, state);
  state.studyWorkspace.revision.content.execution.extensions.syntheticFixture = false;
  const results = await runCleanupVerification(baseUrl, state);
  assert.equal(results.find(row => row.testCaseId === 'PQ-040')!.passed, false);
  assert.equal(calls.some(call => call.method === 'DELETE'), false);
});
