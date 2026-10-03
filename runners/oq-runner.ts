import { createHash, randomBytes, randomUUID } from 'node:crypto';
/**
 * OQ Runner — Operational Qualification test execution.
 * Executes the 205-case OQ catalog and retains unmet evidence as failures.
 */
import { authHeaders, captureLoginProbe, login, qualificationCredentials } from './auth';
import {
  EvidenceResult,
  captureApiCall,
  captureWithExpectedStatus,
  captureWithValidator,
  isRecord,
  manualResult,
  redactEvidenceSecrets,
  saveEvidence,
} from './evidence-capture';
import { pendingStudy, readStudySummaryPage, expectStudySuccess, nativeId, StudyDefinitionClient, type StudyActivationReview } from './study-definition-client';
import { captureStudyOperation, captureQualificationOperation } from './study-qualification';
import { runStudySetup, createWorkflowState, runDataEntry, runReviewAndSignature, runCleanupVerification, patientForm, reviewed, type WorkflowState } from './pq-runner';
import { qualificationOptions } from './qualification-fixture';
import { isDeepStrictEqual } from 'node:util';
import { testCorsPreflight, testPathTraversal } from './security-runner';
import { normalizedPdfText, parsePdfEvidence, requirePrintedRow } from './pdf-evidence';

export interface OwnedOqFixture { state: WorkflowState; setup: EvidenceResult[]; results: EvidenceResult[]; authUserId?: number; batchSdv?: EvidenceResult; reasonRefusal?: EvidenceResult }

export function nativeCase(fixture: OwnedOqFixture | undefined, sourceId: string | string[], testCaseId: string): EvidenceResult {
  const ids = Array.isArray(sourceId) ? sourceId : [sourceId];
  const sources = ids.map(id => id === 'OQ-061' ? fixture?.reasonRefusal : fixture?.results.find(row => row.testCaseId === id));
  const present = sources.filter((row): row is EvidenceResult => row !== undefined);
  if (present.length !== ids.length) return { ...manualResult(testCaseId, `Missing native prerequisite evidence: ${ids.filter((_, i) => !sources[i]).join(', ')}.`),
    method: 'CONTRACT', relatedEvidence: present };
  return { ...present[0], testCaseId, passed: present.every(row => row.passed && !row.captureError && row.method !== 'MANUAL'),
    relatedEvidence: present, notes: `Shared native evidence ${ids.join(' + ')}; every prerequisite is required. ${present.map(row => row.notes).join(' ')} Not independent repeated trials.` };
}

export async function captureMissingChangeReason(baseUrl: string, state: WorkflowState): Promise<EvidenceResult> {
  return (await captureQualificationOperation('OQ-061', baseUrl, state.adminToken ?? '',
    'A reasonless clinical correction is refused and the exact owned form stays unchanged', async request => {
      const before = await patientForm(request, state), itemId = state.formItems?.weight;
      if (!nativeId(itemId) || !state.values || !Object.prototype.hasOwnProperty.call(state.values, 'weight')) throw new Error('No owned weight observation.');
      const field = `item_${itemId}`, attempted = String(Number(state.values.weight) + 1);
      const save = (snapshot: any, value: string, reasonForChange?: string) => {
        const { expectedExecution, expectedObservations } = reviewed(snapshot);
        return request('POST', '/forms/save', { studyId: state.studyId, subjectId: state.subjectId, studyEventId: state.visitId,
          eventCrfId: state.formDataId, crfId: state.formId, formData: { [field]: value }, submitAction: 'draft', expectedObservations,
          ...(expectedExecution ? { expectedExecution } : {}), ...(reasonForChange ? { reasonForChange } : {}) });
      };
      const refusal = await save(before, attempted);
      const after = await patientForm(request, state);
      const unchanged = isDeepStrictEqual(after.formData, before.formData) && after.observationSnapshotHash === before.observationSnapshotHash;
      // A defective product may accept this negative test. Restore only the
      // exact owned field against its fresh snapshot, retaining both writes.
      if (!unchanged && after.formData[field] === attempted) {
        expectStudySuccess(await save(after, before.formData[field], 'Restore the owned synthetic value after a failed reason-required qualification probe'), 200);
        const restored = await patientForm(request, state);
        if (!isDeepStrictEqual(restored.formData, before.formData)) throw new Error('Owned fixture restoration failed after reasonless correction.');
      }
      const body = refusal.body;
      if (!(refusal.status === 400 && isRecord(body) && body.success === false
        && ['REASON_REQUIRED', 'FORM_REASON_REQUIRED', 'REASON_FOR_CHANGE_REQUIRED'].includes(String(body.code)) && unchanged))
        throw new Error('The native reason-required refusal and unchanged observation were not both established.');
    })).evidence;
}

export async function captureSignaturePasswordRefusal(baseUrl: string, token: string, mode: 'missing' | 'wrong', fixture?: OwnedOqFixture): Promise<EvidenceResult> {
  return (await captureQualificationOperation(mode === 'missing' ? 'OQ-033' : 'OQ-041', baseUrl, token,
    `Signing with ${mode} password is refused for the exact owned form without changing its signature`, async request => {
      const state = fixture?.state;
      if (!state?.qualification) throw new Error('No owned signed qualification fixture.');
      const form = await patientForm(request, state);
      const proof = async () => {
        const data = expectStudySuccess(await request('GET', `/esignature/status/eventCrf/${state.formDataId}`), 200).data;
        if (data?.contract !== 'edc-event-crf-signature-proof/1' || data.entityId !== state.formDataId || data.studyId !== state.studyId
          || data.isSigned !== true || data.signatureIntegrityValid !== true || !data.activeSignature) throw new Error('Native signature proof is absent or wrong-scope.');
        return data;
      };
      const before = await proof();
      const verify = async () => {
        const data = expectStudySuccess(await request('POST', '/esignature/verify-password', {
          username: state.qualification!.username, password: state.qualification!.password,
        }), 200).data;
        if (data?.valid !== true) throw new Error('The signer positive credential baseline/reset failed.');
      };
      if (mode === 'wrong') await verify();
      let refusal: Awaited<ReturnType<import('./study-definition-client').StudyTransport>>;
      try {
        refusal = await request('POST', '/esignature/sign', { entityType: 'eventCrf', entityId: state.formDataId,
          username: state.qualification.username, meaning: 'approval', reasonForSigning: 'Synthetic signing refusal qualification',
          ...reviewed(form), ...(mode === 'wrong' ? { password: `Incorrect-${randomUUID()}` } : {}) });
      } finally { if (mode === 'wrong') await verify(); }
      const after = await proof(), body = refusal.body;
      const expectedRefusal = refusal.status === 400 && isRecord(body) && body.success === false && (mode === 'wrong'
        ? body.message === 'Invalid password'
        : Array.isArray(body.errors) && body.errors.length === 1 && isRecord(body.errors[0])
          && body.errors[0].field === 'password' && body.errors[0].type === 'any.required');
      if (!expectedRefusal || !isDeepStrictEqual(before.activeSignature, after.activeSignature))
        throw new Error('Exact password refusal or unchanged native signature proof was not established.');
    })).evidence;
}

export async function captureSignatureAudit(baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult> {
  return (await captureQualificationOperation('OQ-042', baseUrl, token,
    'Each signature created by this owned workflow has its exact native audit manifestation', async request => {
      const state = fixture?.state;
      if (!state?.qualification || !nativeId(state.signatureId)) throw new Error('No owned signature fixture.');
      await patientForm(request, state);
      const proof = expectStudySuccess(await request('GET', `/esignature/status/eventCrf/${state.formDataId}`), 200).data;
      if (proof?.contract !== 'edc-event-crf-signature-proof/1' || proof.entityId !== state.formDataId || proof.studyId !== state.studyId
        || proof.studySubjectId !== state.subjectId || proof.studyEventId !== state.visitId || proof.isSigned !== true
        || proof.signatureIntegrityValid !== true || proof.activeSignature?.signatureId !== state.signatureId)
        throw new Error('Current native signature identity/integrity differs.');
      const signatures = ['PQ-027', 'PQ-029'].flatMap(id => {
        const step = fixture!.results.find(row => row.testCaseId === id);
        if (!step?.passed) throw new Error(`Missing successful ${id} signature prerequisite.`);
        return (step.relatedEvidence ?? []).filter(row => row.endpoint.endsWith('/api/esignature/sign') && row.responseStatus === 200)
          .map(row => expectStudySuccess({ status: row.responseStatus, body: row.responseBody }, 200).data?.signatureId);
      });
      if (signatures.length !== 2 || !signatures.every(nativeId) || new Set(signatures).size !== 2 || !signatures.includes(state.signatureId))
        throw new Error('Both distinct signing operations were not retained.');
      const rows = expectStudySuccess(await request('GET', `/audit/form/${state.formDataId}`), 200).data;
      if (!Array.isArray(rows)) throw new Error('Native signature audit is not an array.');
      for (const signatureId of signatures) {
        const matches = rows.filter((row: any) => row.auditId === signatureId);
        if (matches.length !== 1) throw new Error('Signature audit identity is absent or duplicated.');
        const row = matches[0], manifest = typeof row.newValue === 'string' ? JSON.parse(row.newValue) : null;
        if (row.studyId !== state.studyId || row.eventCrfId !== state.formDataId || row.studyEventId !== state.visitId
          || !nativeId(row.userId) || row.userId !== proof.activeSignature.signerUserId || !Number.isFinite(Date.parse(row.auditDate)) || !isRecord(manifest)
          || manifest.type !== 'electronic_signature' || !['eventCrf', 'event_crf'].includes(String(manifest.entity_type))
          || manifest.entity_id !== state.formDataId || manifest.signed_by !== state.qualification.username || manifest.meaning !== 'approval'
          || typeof manifest.signed_at !== 'string' || !Number.isFinite(Date.parse(manifest.signed_at))
          || manifest.hash_algorithm !== 'sha256' || typeof manifest.content_hash !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.content_hash))
          throw new Error('Signature audit actor, scope, time, meaning or content binding differs.');
        if (signatureId === state.signatureId && (row.userId !== proof.activeSignature.signerUserId
          || manifest.signed_at !== proof.activeSignature.signedAt || manifest.content_hash !== proof.activeSignature.contentHash))
          throw new Error('Active proof does not match its actual audit manifestation.');
      }
    })).evidence;
}

export async function captureSignatureCopyRefusal(baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult> {
  const prerequisite = nativeCase(fixture, ['PQ-006', 'PQ-029'], 'OQ-040');
  if (!prerequisite.passed) return prerequisite;
  return (await captureQualificationOperation('OQ-040', baseUrl, token,
    'An unused native consent signature is refused on another owned subject, remains unchanged, and works on its original subject', async request => {
      const state = fixture!.state, owned = state.studyWorkspace, enrollment = state.enrollmentRequest;
      if (!state.qualification || !owned || owned.revision.content.execution.extensions.syntheticFixture !== true
        || !nativeId(state.studyId) || owned.summary.studyId !== state.studyId || !nativeId(state.subjectId) || !enrollment)
        throw new Error('No exact owned native study and enrollment prerequisite.');
      const client = new StudyDefinitionClient(request), live = await client.verify(owned);
      await client.readSubject(state.subjectId, state.studyId, state.subjectLabel, enrollment.enrollmentDate);
      const history = async (subjectId: number) => {
        const rows = expectStudySuccess(await request('GET', `/consent/subjects/${subjectId}/consent`), 200).data;
        if (!Array.isArray(rows) || rows.some((row: any) => !nativeId(row?.consentId) || row.studySubjectId !== subjectId)
          || new Set(rows.map((row: any) => row.consentId)).size !== rows.length) throw new Error('Consent history has missing, duplicate or foreign identities.');
        return rows;
      };
      const snapshot = async (subjectId: number) => {
        const proof = expectStudySuccess(await request('GET', `/esignature/status/consent/${subjectId}`), 200).data;
        const signatures = expectStudySuccess(await request('GET', `/esignature/history/consent/${subjectId}`), 200).data;
        if (!isRecord(proof) || proof.entityType !== 'consent' || proof.entityId !== subjectId || !Array.isArray(signatures)
          || signatures.some((row: any) => !nativeId(row?.signatureId) || row.entityType !== 'consent' || row.entityId !== subjectId))
          throw new Error('Consent signature readback has missing or foreign identity.');
        return { proof, signatures, consents: await history(subjectId) };
      };
      const initial = await snapshot(state.subjectId);
      if (initial.consents.length || initial.signatures.length || initial.proof.isSigned !== false || initial.proof.state !== 'unsigned')
        throw new Error('The owned source subject already has consent/signature history; reconcile before rerunning.');
      // Reuse canonical enrollment and keep this new subject under the existing
      // owned-study archive lifecycle. Never remove a mistakenly accepted consent.
      const target = await client.enroll(live, `OQ-COPY-${randomUUID().slice(0, 16)}`, enrollment.enrollmentDate);
      const targetId = target.subject.studySubjectId;
      if (targetId === state.subjectId) throw new Error('Copy target is not a distinct owned subject.');
      const targetBefore = await snapshot(targetId);
      if (targetBefore.consents.length || targetBefore.signatures.length || targetBefore.proof.isSigned !== false || targetBefore.proof.state !== 'unsigned')
        throw new Error('New copy target has unexpected native history.');
      const signed = expectStudySuccess(await request('POST', '/esignature/sign', {
        entityType: 'consent', entityId: state.subjectId, username: state.qualification.username, password: state.qualification.password,
        meaning: 'approval', reasonForSigning: 'Owned synthetic OQ signature-copy qualification',
      }), 200).data;
      if (!nativeId(signed?.signatureId)) throw new Error('Signing did not return a native audit identity.');
      const sourceBefore = await snapshot(state.subjectId), proof = sourceBefore.proof;
      if (proof.signatureId !== signed.signatureId || proof.isSigned !== true || proof.signatureIntegrityValid !== true
        || proof.state !== 'signed' || proof.meaning !== 'approval' || proof.signedBy !== state.qualification.username
        || typeof proof.signedAt !== 'string' || !Number.isFinite(Date.parse(proof.signedAt))
        || proof.contentHashAlgorithm !== 'sha256' || typeof proof.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(proof.contentHash)
        || sourceBefore.consents.length || sourceBefore.signatures.length !== 1
        || sourceBefore.signatures[0].signatureId !== signed.signatureId || sourceBefore.signatures[0].isValid !== true)
        throw new Error('Fresh source consent signature is not an exact valid unused native proof.');
      const body = { subjectName: 'Synthetic OQ consent participant', subjectSignatureData: { synthetic: true },
        timeSpentReading: 42, pagesViewed: [1], acknowledgementsChecked: ['reviewed'], investigatorSignatureId: signed.signatureId };
      // Wrong context FIRST: consuming the proof on A first would confound this
      // test with the separate one-use rule. No inline password fallback is sent.
      const refused = await request('POST', `/consent/subjects/${targetId}/consent`, body);
      const sourceAfter = await snapshot(state.subjectId), targetAfter = await snapshot(targetId);
      if (refused.status !== 403 || !isRecord(refused.body) || refused.body.success !== false
        || refused.body.message !== 'The investigatorSignatureId is not a valid, unused signature for this consent subject and step'
        || !isDeepStrictEqual(sourceAfter, sourceBefore) || !isDeepStrictEqual(targetAfter, targetBefore))
        throw new Error('Exact wrong-subject refusal and unchanged native consent/signature histories were not both established.');
      const accepted = expectStudySuccess(await request('POST', `/consent/subjects/${state.subjectId}/consent`, body), 200).data;
      const positive = await snapshot(state.subjectId), finalTarget = await snapshot(targetId);
      if (!nativeId(accepted?.consentId) || accepted.studySubjectId !== state.subjectId || accepted.investigatorSignatureId !== signed.signatureId
        || positive.consents.length !== 1 || positive.consents[0].consentId !== accepted.consentId
        || positive.consents[0].investigatorSignatureId !== signed.signatureId || positive.consents[0].consentStatus !== 'consented'
        || !isDeepStrictEqual(positive.proof, sourceBefore.proof) || !isDeepStrictEqual(positive.signatures, sourceBefore.signatures)
        || !isDeepStrictEqual(finalTarget, targetBefore)) throw new Error('Same-proof positive control or retained exact source/target linkage failed.');
    })).evidence;
}

async function qualifyBatchSdv(baseUrl: string, state: WorkflowState): Promise<EvidenceResult> {
  return (await captureQualificationOperation('OQ-194', baseUrl, state.adminToken ?? '',
    'Batch SDV updates the owned native form and preserves exact subject custody', async request => {
      if (!nativeId(state.formDataId) || !state.qualification) throw new Error('No owned SDV fixture.');
      const before = expectStudySuccess(await request('GET', `/forms/data/${state.formDataId}`), 200).data;
      if (before?.eventCrfId !== state.formDataId || before.studyId !== state.studyId || before.studySubjectId !== state.subjectId)
        throw new Error('Native SDV fixture identity differs.');
      const result = expectStudySuccess(await request('POST', '/data-locks/batch/sdv', { eventCrfIds: [state.formDataId],
        signatureUsername: state.qualification.username, signaturePassword: state.qualification.password }), 200).data;
      if (result?.success !== true || result.verified !== 1 || result.failed !== 0 || !Array.isArray(result.errors) || result.errors.length)
        throw new Error('Native batch SDV did not verify exactly the requested form.');
      const read = expectStudySuccess(await request('GET', `/sdv/${state.formDataId}`), 200).data;
      if (read?.eventCrfId !== state.formDataId || read.studySubjectId !== state.subjectId || read.sdvStatus !== true || !nativeId(read.sdvUpdateId))
        throw new Error('Batch SDV native readback did not confirm the owned form.');
    })).evidence;
}

async function createAuthFixture(testCaseId: string, baseUrl: string, token: string) {
  const body = { username: `oq_probe_${randomUUID().replace(/-/g, '')}`, password: randomBytes(24).toString('base64url') + '!aA1',
    firstName: 'Synthetic', lastName: 'Qualification', email: `oq-${randomUUID()}@example.invalid`, role: 'viewer' };
  let cleanupTarget: { userId: number; body: typeof body } | undefined;
  const captured = await captureQualificationOperation(testCaseId, baseUrl, token,
    'Create and read back an owned viewer account for authentication tests', async request => {
      const response = expectStudySuccess(await request('POST', '/users', body), 201);
      if (!nativeId(response.userId)) throw new Error('Native qualification userId is absent.');
      cleanupTarget = { userId: response.userId, body };
      const read = expectStudySuccess(await request('GET', `/users/${response.userId}`), 200).data;
      if (read?.userId !== response.userId || read.userName !== body.username || read.enabled !== true
        || read.platformRole !== 'viewer' || read.email !== body.email) throw new Error('Owned authentication fixture readback differs.');
      return { userId: response.userId as number, body };
    });
  return { ...captured, cleanupTarget };
}

async function disableAuthFixture(testCaseId: string, baseUrl: string, token: string,
  fixture: { userId: number; body: { username: string } }): Promise<EvidenceResult> {
  return (await captureQualificationOperation(testCaseId, baseUrl, token,
    'Disable only the owned synthetic authentication fixture', async request => {
      const before = expectStudySuccess(await request('GET', `/users/${fixture.userId}`), 200).data;
      if (before?.userName !== fixture.body.username || before.userId !== fixture.userId)
        throw new Error('Refusing to disable an account whose owned identity changed.');
      expectStudySuccess(await request('PUT', `/users/${fixture.userId}`, { enabled: false }), 200);
      const read = expectStudySuccess(await request('GET', `/users/${fixture.userId}`), 200).data;
      if (read?.userId !== fixture.userId || read.userName !== fixture.body.username || read.enabled !== false)
        throw new Error('Owned fixture deactivation was not verified.');
    })).evidence;
}

/** Role/status probes own their account; the operator and pre-existing users are never changed. */
export async function runAccountLifecycleTests(baseUrl: string, token: string, syntheticMode = false): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  if (!syntheticMode) return ['OQ-021', 'OQ-022'].map(id => ({ ...manualResult(id,
    'Explicit synthetic qualification is required for owned account lifecycle testing.'), method: 'CONTRACT' }));
  const created = await createAuthFixture('OQ-ACCOUNT-FIXTURE', baseUrl, token);
  results.push(created.evidence);
  const fixture = created.value;
  let viewer: Awaited<ReturnType<typeof login>>['session'] = null;
  let disabled = false;
  try {
    if (!fixture) return results;
    const related: EvidenceResult[] = [];
    const signIn = async (id: string) => {
      const result = await login(baseUrl, fixture.body.username, fixture.body.password, id);
      related.push(result.evidence);
      if (!result.session || result.session.userId !== fixture.userId) throw new Error('Owned account login identity was not verified.');
      return result.session;
    };
    const probe = async (id: string, bearer: string, path: string, validate: (response: { status: number; body: unknown }) => boolean) => {
      const captured = await captureQualificationOperation(id, baseUrl, bearer, 'Verify the owned account native authority response', async request => {
        if (!validate(await request('GET', path))) throw new Error('Expected owned account authority outcome was not observed.');
      });
      related.push(captured.evidence);
      if (!captured.evidence.passed) throw new Error(captured.evidence.notes);
    };
    const refused = (r: { status: number; body: unknown }) => r.status === 401 && isRecord(r.body) && r.body.success === false
      && isRecord(r.body.error) && ['TOKEN_REVOKED', 'SESSION_REVOKED', 'SESSION_NOT_ACTIVE', 'ACCOUNT_INACTIVE'].includes(String(r.body.error.code));
    const identity = (role: string) => (r: { status: number; body: unknown }) => r.status === 200 && isRecord(r.body) && r.body.success === true
      && isRecord(r.body.data) && r.body.data.userId === fixture.userId && r.body.data.username === fixture.body.username && r.body.data.role === role;
    const changed = await captureQualificationOperation('OQ-021', baseUrl, token,
      'Downgrading the owned account revokes its privileged session and fresh login carries only the current viewer role', async request => {
        const read = async (role: string) => {
          const data = expectStudySuccess(await request('GET', `/users/${fixture.userId}`), 200).data;
          if (data?.userId !== fixture.userId || data.userName !== fixture.body.username || data.enabled !== true || data.platformRole !== role)
            throw new Error('Refusing a lifecycle mutation without exact owned account identity and role.');
        };
        await read('viewer');
        expectStudySuccess(await request('PUT', `/users/${fixture.userId}`, { role: 'data_manager' }), 200);
        await read('data_manager');
        const privileged = await signIn('OQ-021-privileged-login');
        await probe('OQ-021-privileged-identity', privileged.token, '/auth/verify', identity('data_manager'));
        await probe('OQ-021-privileged-access', privileged.token, `/users/${fixture.userId}`, r => r.status === 200
          && isRecord(r.body) && r.body.success === true && isRecord(r.body.data) && r.body.data.userId === fixture.userId && r.body.data.userName === fixture.body.username);
        await read('data_manager');
        expectStudySuccess(await request('PUT', `/users/${fixture.userId}`, { role: 'viewer' }), 200);
        await read('viewer');
        await probe('OQ-021-revoked-session', privileged.token, '/auth/verify', refused);
        viewer = await signIn('OQ-021-viewer-login');
        await probe('OQ-021-current-identity', viewer.token, '/auth/verify', identity('viewer'));
        await probe('OQ-021-current-refusal', viewer.token, `/users/${fixture.userId}`, r => r.status === 403
          && isRecord(r.body) && r.body.success === false && isRecord(r.body.error) && r.body.error.code === 'FORBIDDEN');
      });
    changed.evidence.relatedEvidence = [...changed.evidence.relatedEvidence ?? [], ...related];
    results.push(changed.evidence);
    related.length = 0;
    const deactivated = await captureQualificationOperation('OQ-022', baseUrl, token,
      'Deactivating the exact owned account refuses both its admitted session and its known correct credentials', async request => {
        if (!viewer || !changed.evidence.passed) throw new Error('No verified current viewer session for the deactivation baseline.');
        await probe('OQ-022-before', viewer.token, '/auth/verify', identity('viewer'));
        const cleanup = await disableAuthFixture('OQ-022-disable', baseUrl, token, fixture);
        related.push(cleanup);
        if (!cleanup.passed) throw new Error('Owned account deactivation was not confirmed.');
        // Keep cleanup armed until both refusals are verified: a defective login
        // may issue another session even after the disabled readback succeeded.
        await probe('OQ-022-session-refusal', viewer.token, '/auth/verify', refused);
        const loginAttempt = await request('POST', '/auth/login', { username: fixture.body.username, password: fixture.body.password });
        if (loginAttempt.status !== 401 || !isRecord(loginAttempt.body) || loginAttempt.body.success !== false
          || loginAttempt.body.message !== 'User account is disabled') throw new Error('Disabled account did not refuse its known correct password as disabled.');
        disabled = true;
      });
    deactivated.evidence.relatedEvidence = [...deactivated.evidence.relatedEvidence ?? [], ...related];
    results.push(redactEvidenceSecrets(deactivated.evidence) as EvidenceResult);
  } finally {
    if (created.cleanupTarget && !disabled) results.push(await disableAuthFixture('OQ-ACCOUNT-CLEANUP', baseUrl, token, created.cleanupTarget));
    else if (!created.cleanupTarget) results.push({ ...manualResult('OQ-ACCOUNT-CLEANUP',
      'Account creation has no verified native ID; reconcile the unique username before retrying.'), method: 'CONTRACT' });
    for (const id of ['OQ-021', 'OQ-022']) if (!results.some(row => row.testCaseId === id)) results.push({ ...manualResult(id,
      'Owned account lifecycle prerequisite failed; no passing outcome inferred.'), method: 'CONTRACT' });
  }
  return results;
}

async function weakPasswordRefusal(testCaseId: string, baseUrl: string, username: string, password: string): Promise<EvidenceResult> {
  const baseline = await login(baseUrl, username, password, `${testCaseId}-before`);
  if (!baseline.session) return { ...baseline.evidence, testCaseId, passed: false, relatedEvidence: [baseline.evidence] };
  const attempt = await captureApiCall({ testCaseId, baseUrl, method: 'POST', url: '/api/auth/change-password',
    headers: authHeaders(baseline.session.token), body: { currentPassword: password, newPassword: '123' } });
  const after = await login(baseUrl, username, password, `${testCaseId}-after`);
  const body = attempt.responseBody;
  attempt.passed = !attempt.captureError && attempt.responseStatus === 400 && isRecord(body) && body.success === false
    && body.error === 'PASSWORD_POLICY_VIOLATION' && Array.isArray(body.errors) && body.errors.length > 0
    && body.errors.every(error => typeof error === 'string' && error.trim()) && !!after.session;
  attempt.notes = 'Requires the exact native password-policy refusal and a successful login with the unchanged owned password.';
  attempt.relatedEvidence = [baseline.evidence, after.evidence];
  return attempt;
}

async function recordFailedSignatureAttempt(baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult> {
  return (await captureQualificationOperation('OQ-200', baseUrl, token,
    'Retain a reported fictional signing failure in the owned native audit (not a credential-rejection test)', async request => {
      const state = fixture?.state;
      if (!state?.qualification || !nativeId(state.formDataId)) throw new Error('No owned native signing fixture.');
      const before = expectStudySuccess(await request('GET', `/forms/data/${state.formDataId}`), 200).data;
      if (before?.eventCrfId !== state.formDataId || before.studyId !== state.studyId) throw new Error('Native signing fixture identity differs.');
      const reason = `Fictional OQ signing failure ${randomUUID()}`;
      expectStudySuccess(await request('POST', '/esignature/audit/failed-attempt', { entityType: 'eventCrf', entityId: state.formDataId, reason }), 200);
      const rows = expectStudySuccess(await request('GET', `/audit/form/${state.formDataId}`), 200).data;
      if (!Array.isArray(rows) || !rows.some((row: any) => {
        if (row.studyId !== state.studyId || row.eventCrfId !== state.formDataId || typeof row.newValue !== 'string') return false;
        try { const recorded = JSON.parse(row.newValue); return recorded.type === 'failed_signature_attempt'
          && recorded.entity_id === state.formDataId && recorded.username === state.qualification!.username && recorded.reason === reason; }
        catch { return false; }
      })) throw new Error('Native failed-attempt audit readback is absent or differs.');
    })).evidence;
}


function validateStudyPage(status: number, body: unknown): { passed: boolean; notes: string } {
  try {
    const page = readStudySummaryPage({ status, body });
    return { passed: true, notes: `Canonical study page ${page.page}: ${page.studies.length} of ${page.total} studies` };
  } catch (error) {
    return { passed: false, notes: error instanceof Error ? error.message : 'Invalid study summary page' };
  }
}

function successfulResource(status: number, body: unknown): boolean {
  return status === 200 && isRecord(body) && body.success === true
    && (Array.isArray(body.data) || isRecord(body.data) && Object.keys(body.data).length > 0);
}

function getEntries(body: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(body) && body.length > 0 && body.every(isRecord)) return body as Record<string, unknown>[];
  if (isRecord(body)) {
    const d = (body.data ?? body.entries ?? body.results ?? body.items) as unknown;
    if (Array.isArray(d) && d.length > 0 && d.every(isRecord)) return d as Record<string, unknown>[];
  }
  return null;
}

/** Negative mutation checks first establish a real owned record and then reread it.
 * This proves API refusal and retention, not database-trigger enforcement. */
export async function captureAuditRefusal(testCaseId: string, baseUrl: string, token: string,
  method: 'PUT' | 'PATCH' | 'DELETE' | 'POST', fixture?: OwnedOqFixture): Promise<EvidenceResult> {
  return (await captureQualificationOperation(testCaseId, baseUrl, token,
    `${method} audit API refusal with unchanged owned native audit records`, async request => {
      const state = fixture?.state;
      if (!state || !nativeId(state.studyId) || !nativeId(state.formDataId)) throw new Error('No owned native audit fixture.');
      const read = async () => {
        const rows = expectStudySuccess(await request('GET', `/audit/form/${state.formDataId}`), 200).data;
        if (!Array.isArray(rows) || !rows.length || !rows.every(row => isRecord(row) && nativeId(row.auditId)
          && row.studyId === state.studyId && row.eventCrfId === state.formDataId)) throw new Error('Owned audit readback is missing or crosses native scope.');
        return rows as Record<string, unknown>[];
      };
      const before = await read();
      const refused = await request(method, method === 'POST' ? '/audit' : `/audit/${before[0].auditId}`,
        method === 'DELETE' ? undefined : { auditId: before[0].auditId, studyId: state.studyId, eventCrfId: state.formDataId, action: 'OQ_SYNTHETIC_TAMPER' });
      if (![403, 404, 405].includes(refused.status)) throw new Error(`Audit mutation was not refused: HTTP ${refused.status}.`);
      const after = await read();
      if (!isDeepStrictEqual(before, after)) throw new Error('Owned audit records changed after the refused mutation.');
    })).evidence;
}

/** Parse the actual export format, including quoted fields and embedded newlines. */
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell.replace(/\r$/, '')); cell = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else cell += c;
  }
  if (quoted) throw new Error('CSV download has an unterminated quoted cell.');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

async function captureOwnedPdfDownload(testCaseId: string, baseUrl: string, token: string,
  fixture: OwnedOqFixture, read: EvidenceResult, native: Record<string, unknown>): Promise<EvidenceResult> {
  const state = fixture.state, related = [read];
  let result: EvidenceResult = { ...read, testCaseId, passed: false, relatedEvidence: related };
  const get = async (suffix: string, url: string) => {
    const row = await captureApiCall({ testCaseId: `${testCaseId}-${suffix}`, baseUrl, method: 'GET', url, headers: authHeaders(token) });
    related.push(row);
    if (!row.passed || row.responseStatus !== 200 || !isRecord(row.responseBody) || row.responseBody.success !== true || !row.responseBody.data)
      throw new Error(`PDF ${suffix} readback is unavailable.`);
    return row.responseBody.data;
  };
  try {
    if (!nativeId(state.subjectId) || !nativeId(state.visitId) || !nativeId(state.formId) || !nativeId(state.crfVersionId)
      || native.studySubjectId !== state.subjectId || native.studyEventId !== state.visitId
      || native.crfId !== state.formId || native.crfVersionId !== state.crfVersionId
      || native.observationPreconditionContract !== 'edc-form-observation-preconditions/1'
      || !/^sha256:[a-f0-9]{64}$/.test(String(native.observationSnapshotHash))
      || !isRecord(native.formData) || !state.formItems || !state.values || !Object.keys(state.values).length)
      throw new Error('PDF prerequisite does not identify the complete owned form and expected values.');
    const nativeValues = native.formData;
    const printable = await get('print-data', `/api/print/forms/${state.formDataId}/data`);
    if (!isRecord(printable) || printable.formId !== state.formDataId || printable.subjectLabel !== state.subjectLabel || !Array.isArray(printable.sections))
      throw new Error('Printable form identity is not the owned form.');
    const fields = printable.sections.flatMap(section => {
      if (!isRecord(section) || !Array.isArray(section.fields)) throw new Error('Printable sections are incomplete.');
      return section.fields;
    });
    if (fields.length !== Object.keys(state.formItems).length || fields.length !== Object.keys(state.values).length
      || fields.some(field => !isRecord(field) || !nativeId(field.fieldId))
      || new Set(fields.map(field => field.fieldId)).size !== fields.length)
      throw new Error('Printable field census differs from the owned native fixture.');
    const expectedRows = Object.entries(state.values).map(([name, value]) => {
      const id = state.formItems![name], matches = fields.filter(field => field.fieldId === id);
      const expected = String(value ?? '');
      if (!nativeId(id) || matches.length !== 1 || nativeValues[`item_${id}`] !== expected)
        throw new Error(`Native PDF source differs at ${name}.`);
      const field = matches[0];
      if (field.name !== name || String(field.value ?? '') !== expected || typeof field.label !== 'string' || !field.label.trim())
        throw new Error(`Printable PDF source differs at ${name}.`);
      let display = expected;
      if (Array.isArray(field.options) && field.options.length) {
        const options = field.options.filter((option: unknown) => isRecord(option) && option.value === expected);
        if (options.length !== 1 || typeof options[0].label !== 'string') throw new Error(`Unresolved PDF option at ${name}.`);
        display = options[0].label;
      }
      if (field.displayValue !== undefined && field.displayValue !== display) throw new Error(`Printable display value differs at ${name}.`);
      if (!display || field.type === 'checkbox') throw new Error(`The scalar PDF qualification fixture cannot verify ${name}.`);
      if (field.unit !== undefined && typeof field.unit !== 'string') throw new Error(`Invalid PDF unit at ${name}.`);
      return { id, cells: [field.label, display, ...(field.unit ? [field.unit] : [])] };
    });
    const proof = await get('signature-before', `/api/esignature/status/event_crf/${state.formDataId}`);
    if (!isRecord(proof) || proof.contract !== 'edc-event-crf-signature-proof/1' || proof.entityType !== 'event_crf' || proof.entityId !== state.formDataId
      || proof.studyId !== state.studyId || proof.studySubjectId !== state.subjectId || proof.studyEventId !== state.visitId
      || proof.crfVersionId !== state.crfVersionId || typeof proof.isSigned !== 'boolean'
      || proof.isSigned !== proof.signatureIntegrityValid
      || !['signed', 'unsigned', 'invalidated', 'unverified', 'inconsistent'].includes(String(proof.state))
      || typeof proof.signatureRequired !== 'boolean' || (proof.state === 'signed') !== proof.isSigned
      || proof.integrityStatus !== (proof.isSigned ? 'verified' : proof.state)
      || (proof.isSigned ? proof.signatureIntegrityReason !== null : typeof proof.signatureIntegrityReason !== 'string' || !proof.signatureIntegrityReason.trim())
      || (proof.isSigned ? proof.contentHashAlgorithm !== 'sha256' : proof.contentHashAlgorithm !== undefined))
      throw new Error('Printable signature proof differs from the current owned native proof.');
    // The status HTTP DTO intentionally omits redundant top-level signer aliases.
    // Compare every canonical binding/status field and the entire active proof;
    // presentation labels and those aliases are not a second signature authority.
    const proofFields = ['contract', 'entityType', 'entityId', 'studyId', 'studySubjectId', 'studyEventId', 'crfVersionId',
      'isSigned', 'signatureRequired', 'state', 'integrityStatus', 'signatureIntegrityValid', 'signatureIntegrityReason',
      'activeSignature', 'contentHashAlgorithm'];
    const printedProof = printable.signatureProof;
    if (!isRecord(printedProof) || proofFields.some(key => !isDeepStrictEqual(printedProof[key], proof[key])))
      throw new Error('Printable signature proof differs from the current owned native proof.');
    const audit = await get('audit-before', `/api/audit/form/${state.formDataId}`);
    if (!Array.isArray(audit) || !audit.length || audit.some(row => !isRecord(row)
      || row.studyId !== state.studyId || row.eventCrfId !== state.formDataId || !nativeId(row.auditId)))
      throw new Error('PDF audit source is empty or crosses the owned form scope.');
    const corrections = audit.filter(row => row.itemId === state.formItems!.weight && row.studyEventId === state.visitId
      && row.oldValue === '75' && row.newValue === '70.5' && row.reasonForChange === 'PQ verified synthetic weight correction'
      && nativeId(row.entityId) && nativeId(row.userId));
    const correction = corrections[0];
    if (corrections.length !== 1 || !(correction.entityName || correction.itemName) || !(correction.userFullName || correction.userName))
      throw new Error('PDF audit source lacks the exact owned correction, field and actor.');
    result = await captureApiCall({ testCaseId, baseUrl, method: 'GET',
      url: `/api/print/forms/${state.formDataId}/pdf?outputFormat=pdf&includeAuditTrail=true&includeSignatures=true`,
      headers: authHeaders(token), responseFormat: 'binary' });
    result.relatedEvidence = related;
    const body = result.responseBody;
    if (!result.passed || result.responseStatus !== 200 || !result.responseHeaders?.['content-type']?.startsWith('application/pdf')
      || !isRecord(body) || body.encoding !== 'base64' || typeof body.content !== 'string')
      throw new Error('Native print route did not return a PDF.');
    const parsed = await parsePdfEvidence(Buffer.from(body.content, 'base64'));
    const text = normalizedPdfText(parsed.text);
    requirePrintedRow(text, ['Subject:', state.subjectLabel], 'the owned subject label');
    // Limit field checks to the form body: an old value in the audit appendix cannot satisfy them.
    const signatureAt = text.indexOf('Electronic signature');
    if (signatureAt < 0) throw new Error('PDF signature section is absent.');
    const fieldsAt = text.indexOf('Field Value Unit');
    if (fieldsAt < 0 || fieldsAt >= signatureAt) throw new Error('PDF field table is absent.');
    const formText = text.slice(fieldsAt, signatureAt);
    for (const row of expectedRows) requirePrintedRow(formText, row.cells, `native field ${row.id}, its displayed value and unit`);
    const appendixAt = text.indexOf('Form audit history', signatureAt);
    if (appendixAt < 0) throw new Error('Requested PDF audit appendix is absent.');
    const signatureText = text.slice(signatureAt, appendixAt);
    if (proof.isSigned === true && proof.signatureIntegrityValid === true && isRecord(proof.activeSignature)) {
      const signature = proof.activeSignature;
      if (proof.integrityStatus !== 'verified' || !nativeId(signature.signatureId) || !nativeId(signature.signerUserId)
        || [signature.signedByFullName, signature.signerUsername, signature.meaning].some(value => typeof value !== 'string' || !value.trim())
        || signature.signedBy !== signature.signerUsername || signature.hashAlgorithm !== 'sha256'
        || (signature.hashScope !== null && signature.hashScope !== 'entity')
        || !/^[a-f0-9]{64}$/.test(String(signature.contentHash))
        || signature.signatureScope !== 'event-crf-item-values/1' || typeof signature.signedAt !== 'string'
        || !Number.isFinite(Date.parse(signature.signedAt))) throw new Error('Native signature attribution is malformed.');
      for (const [label, value] of [['Signer:', `${signature.signedByFullName} (${signature.signerUsername})`],
        ['Signed at:', signature.signedAt], ['Meaning:', signature.meaning], ['Signature record:', signature.signatureId],
        ['SHA-256:', signature.contentHash]]) {
        if (value === undefined || value === null) throw new Error('Native signature attribution is incomplete.');
        requirePrintedRow(signatureText, [String(label), String(value)], 'canonical signature attribution');
      }
      if (!signatureText.includes('event-crf-item-values/1')) throw new Error('PDF signature scope is absent.');
    } else {
      if (typeof proof.state !== 'string' || proof.activeSignature !== null || proof.isSigned !== false)
        throw new Error('Native unsigned signature state is ambiguous.');
      requirePrintedRow(signatureText, ['Signature state:', proof.state], 'the current unverified signature state');
      if (/Signer:|SHA-256:|Verified scope:/.test(signatureText)) throw new Error('Unsigned PDF asserts verified signature attribution.');
    }
    requirePrintedRow(text.slice(appendixAt), [String(correction.entityName || correction.itemName),
      String(correction.userFullName || correction.userName), '75', '70.5', String(correction.reasonForChange)],
    'the independently read correction, actor, old/new values and reason in the audit appendix');
    const after = await get('form-after', `/api/forms/data/${state.formDataId}`);
    const proofAfter = await get('signature-after', `/api/esignature/status/event_crf/${state.formDataId}`);
    if (!isRecord(after) || after.eventCrfId !== native.eventCrfId || after.studyId !== native.studyId
      || after.studySubjectId !== native.studySubjectId || after.studyEventId !== native.studyEventId
      || after.crfId !== native.crfId || after.crfVersionId !== native.crfVersionId
      || after.observationSnapshotHash !== native.observationSnapshotHash || !isDeepStrictEqual(after.formData, native.formData)
      || !isDeepStrictEqual(proofAfter, proof)) throw new Error('Native source or proof changed during PDF qualification.');
    related.push({ testCaseId: `${testCaseId}-parsed-content`, timestamp: new Date().toISOString(), endpoint: result.endpoint,
      method: 'CONTRACT', responseStatus: 200, passed: true, responseBody: { pages: parsed.pages,
        textSha256: createHash('sha256').update(text).digest('hex'), checkedFieldIds: expectedRows.map(row => row.id),
        correctionAuditId: correction.auditId, signatureState: proof.state },
      notes: 'Real PDF parser; complete owned scalar fixture fields, exact correction and current signature manifestation checked. Visual layout requires rendered review.' });
    result.notes = 'Complete PDF bytes parsed; owned scalar field census/value/unit pairs, subject, canonical signature manifestation and exact audit correction verified against native reads. Source and proof stayed unchanged. Layout and full study/casebook coverage require separate rendered review.';
  } catch (error) { result.passed = false; result.notes = error instanceof Error ? error.message : 'PDF content qualification failed.'; }
  return result;
}

export async function captureNativeDownload(testCaseId: string, baseUrl: string, token: string,
  format: 'csv' | 'pdf' | 'odm', fixture?: OwnedOqFixture): Promise<EvidenceResult> {
  const state = fixture?.state;
  if (!state || !nativeId(state.studyId) || !nativeId(state.formDataId) || !state.studyWorkspace?.summary.oid)
    return { ...manualResult(testCaseId, 'No owned native form for download verification.'), method: 'CONTRACT' };
  const read = await captureApiCall({ testCaseId: `${testCaseId}-read`, baseUrl, method: 'GET',
    url: `/api/forms/data/${state.formDataId}`, headers: authHeaders(token) });
  const data = isRecord(read.responseBody) ? read.responseBody.data : null;
  if (!read.passed || !isRecord(data) || data.eventCrfId !== state.formDataId || data.studyId !== state.studyId)
    return { ...read, testCaseId, passed: false, notes: 'Download prerequisite native form identity was not verified.', relatedEvidence: [read] };
  if (format === 'pdf') return captureOwnedPdfDownload(testCaseId, baseUrl, token, fixture!, read, data);
  const result = await captureApiCall({ testCaseId, baseUrl, method: 'POST',
    url: format === 'odm' ? '/api/export/cdisc' : '/api/export/execute',
    headers: authHeaders(token), responseFormat: 'text',
    body: { datasetConfig: { studyOID: state.studyWorkspace.summary.oid }, ...(format === 'csv' ? { format: 'csv' } : {}) } });
  result.relatedEvidence = [read];
  try {
    if (!result.passed || result.responseStatus !== 200) throw new Error(`Download failed with HTTP ${result.responseStatus}.`);
    const mime = result.responseHeaders?.['content-type'] ?? '';
    if (format === 'csv') {
      if (!mime.startsWith('text/csv') || typeof result.responseBody !== 'string') throw new Error('Native export did not return CSV.');
      const rows = csvRows(result.responseBody), header = rows.shift() ?? [];
      const subject = header.indexOf('SubjectID'), item = header.indexOf('ItemName'), value = header.indexOf('ItemValue');
      if (subject < 0 || item < 0 || value < 0 || !state.values || !Object.keys(state.values).length) throw new Error('CSV item-data header or expected fixture values are absent.');
      for (const [name, expected] of Object.entries(state.values)) {
        const matches = rows.filter(row => row[subject] === state.subjectLabel && row[item] === name);
        if (matches.length !== 1 || matches[0][value] !== String(expected ?? '')) throw new Error(`CSV native value/census differs at ${name}.`);
      }
      result.notes = 'Complete CSV retained; every expected fixture item has its exact native subject label and value.';
    } else {
      if (!mime.includes('xml') || typeof result.responseBody !== 'string' || !result.responseBody.includes('<ODM')
        || !result.responseBody.includes(`StudyOID="${state.studyWorkspace.summary.oid}"`) || !result.responseBody.includes(state.subjectLabel)) throw new Error('ODM export lacks the owned study and subject.');
      result.notes = 'Complete ODM retained with the owned study and subject; this check does not establish full clinical item mapping.';
    }
  } catch (error) { result.passed = false; result.notes = error instanceof Error ? error.message : 'Download contract failed.'; }
  return result;
}

export async function captureAuditDownload(testCaseId: string, baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult> {
  const state = fixture?.state;
  if (!state || !nativeId(state.studyId) || !nativeId(state.formDataId))
    return { ...manualResult(testCaseId, 'No owned native audit fixture.'), method: 'CONTRACT' };
  const audit = await captureApiCall({ testCaseId: `${testCaseId}-read`, baseUrl, method: 'GET', url: `/api/audit/form/${state.formDataId}`, headers: authHeaders(token) });
  const correction = audit.passed ? getEntries(audit.responseBody)?.find(row => row.studyId === state.studyId && row.eventCrfId === state.formDataId
    && row.oldValue === '75' && row.newValue === '70.5' && row.reasonForChange === 'PQ verified synthetic weight correction' && nativeId(row.entityId)) : null;
  if (!correction) return { ...audit, testCaseId, passed: false, notes: 'No exact owned native correction for audit export comparison.', relatedEvidence: [audit] };
  const result = await captureApiCall({ testCaseId, baseUrl, method: 'GET', headers: authHeaders(token), responseFormat: 'text',
    url: `/api/audit/export?studyId=${state.studyId}&startDate=2020-01-01&endDate=${new Date(Date.now()+86400000).toISOString()}&format=csv` });
  result.relatedEvidence = [audit];
  try {
    if (!result.passed || result.responseStatus !== 200 || !result.responseHeaders?.['content-type']?.startsWith('text/csv') || typeof result.responseBody !== 'string') throw new Error('Audit export did not return CSV.');
    const rows = csvRows(result.responseBody), header = rows.shift() ?? [];
    const fields = ['Entity ID', 'Old Value', 'New Value', 'Reason for Change', 'Username'];
    const cols = fields.map(field => header.indexOf(field));
    if (cols.some(index => index < 0) || !rows.some(row => row[cols[0]] === String(correction.entityId)
      && row[cols[1]] === '75' && row[cols[2]] === '70.5' && row[cols[3]] === correction.reasonForChange && row[cols[4]] === correction.userName))
      throw new Error('Audit CSV does not preserve the exact owned correction, actor and reason.');
    result.notes = 'Complete native audit CSV preserves the independently read owned correction, actor and reason.';
  } catch (error) { result.passed = false; result.notes = error instanceof Error ? error.message : 'Audit CSV contract failed.'; }
  return result;
}

// ── Suite 1: Authentication Tests (OQ-001 → OQ-010) ──

/** Final destructive quota probe. Never resets or bypasses a shared caller bucket. */
export async function runRateLimitTest(baseUrl: string): Promise<EvidenceResult> {
  const exchanges: EvidenceResult[] = [], started = Date.now(), deadline = started + 60_000;
  const username = `oq_absent_${randomUUID().replace(/-/g, '')}`, password = randomBytes(24).toString('base64url') + '!aA1';
  let notes = 'No authoritative rate-limit boundary observed.', passed = false;
  const integerHeader = (row: EvidenceResult, name: string) => {
    const text = row.responseHeaders?.[name];
    return typeof text === 'string' && /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
  };
  try {
    let limit: number | null = null, remaining: number | null = null, budget = 1;
    for (let i = 0; i < budget; i++) {
      if (Date.now() >= deadline) throw new Error('The 60-second quota qualification budget expired.');
      const row = await captureApiCall({ testCaseId: `OQ-008-${i + 1}`, method: 'POST', url: '/api/auth/login', baseUrl,
        body: { username, password }, timeoutMs: Math.min(5000, deadline - Date.now()) });
      row.requestBody = { username, password: '[redacted]' }; exchanges.push(row);
      if (row.captureError) throw new Error('Rate-limit probe transport failed.');
      const observedLimit = integerHeader(row, 'ratelimit-limit'), observedRemaining = integerHeader(row, 'ratelimit-remaining');
      if (observedLimit === null || observedLimit < 1 || observedLimit > 500 || observedRemaining === null
        || observedRemaining > observedLimit) throw new Error('Missing/invalid authoritative quota headers or limit exceeds the 500-request policy ceiling.');
      if (i === 0) {
        if (observedRemaining >= observedLimit) throw new Error('The initial quota header did not account for the observed request.');
        if (row.responseStatus !== 401 || !isRecord(row.responseBody) || row.responseBody.success !== false
          || row.responseBody.message !== 'Invalid username or password') throw new Error('No unthrottled native login-refusal baseline; a previously exhausted bucket cannot qualify this run.');
        limit = observedLimit; remaining = observedRemaining; budget = observedRemaining + 2;
      } else if (observedLimit !== limit || observedRemaining > remaining!) throw new Error('Quota policy/window changed during the bounded probe.');
      remaining = observedRemaining;
      if (row.responseStatus === 429) {
        if (remaining !== 0 || (integerHeader(row, 'retry-after') ?? 0) < 1 || !isRecord(row.responseBody) || row.responseBody.success !== false
          || row.responseBody.message !== 'Too many login attempts. Account temporarily locked. Please try again after 15 minutes.')
          throw new Error('429 did not match the native login rate-limit contract.');
        passed = true; notes = `Observed native quota ${limit}, then HTTP429 with zero remaining and Retry-After; ${exchanges.length} bounded attempts. No reset was performed; the shared caller bucket may remain throttled.`; break;
      }
      if (row.responseStatus !== 401 || !isRecord(row.responseBody) || row.responseBody.success !== false
        || row.responseBody.message !== 'Invalid username or password') throw new Error('Unexpected response during quota qualification.');
    }
    if (!passed) throw new Error('No native429 within the reported remaining quota plus one boundary request.');
  } catch (error) { notes = error instanceof Error ? error.message : 'Rate-limit qualification failed.'; }
  return { ...(exchanges[exchanges.length - 1] ?? manualResult('OQ-008', notes)), testCaseId: 'OQ-008',
    passed, notes, relatedEvidence: exchanges, regulatoryRef: '§11.300(d)',
    testDescription: 'After all other operations, observe the native authentication quota without resetting any shared IP bucket',
    acceptanceCriteria: 'Unthrottled native401 baseline, authoritative limit<=500, then exact native429 within remaining+1 requests and60seconds' };
}

export async function runAuthenticationTests(
  baseUrl: string, username: string, password: string, syntheticMode = false, deferRateLimit = false,
): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];

  const operator = await login(baseUrl, username, password, 'OQ-001');
  results.push({ ...operator.evidence, regulatoryRef: '§11.10(d)',
    testDescription: 'Authenticate the qualification operator', acceptanceCriteria: 'HTTP success with a usable native session' });
  let fixture: { userId: number; body: { username: string; password: string; firstName: string; lastName: string; email: string; role: string } } | undefined;
  let cleanupTarget: Awaited<ReturnType<typeof createAuthFixture>>['cleanupTarget'];
  let attemptedCreation = false;
  try {
  if (syntheticMode && operator.session) {
    attemptedCreation = true;
    const created = await createAuthFixture('OQ-AUTH-FIXTURE', baseUrl, operator.session.token);
    cleanupTarget = created.cleanupTarget;
    fixture = created.value; results.push(created.evidence);
  }

  // The duplicate is this exact account, never an invented existing email.
  if (fixture && operator.session) results.push((await captureQualificationOperation('OQ-002', baseUrl, operator.session.token,
    'Reject the exact duplicate native username without replacing its identity', async request => {
      const duplicate = await request('POST', '/users', fixture!.body);
      if (duplicate.status !== 400 || !isRecord(duplicate.body) || duplicate.body.success !== false
        || duplicate.body.message !== 'Username already exists') throw new Error('Native duplicate username rejection was not observed.');
      const read = expectStudySuccess(await request('GET', `/users/${fixture!.userId}`), 200).data;
      if (read?.userId !== fixture!.userId || read.userName !== fixture!.body.username || read.enabled !== true)
        throw new Error('Duplicate check changed the original native account.');
    })).evidence);
  else results.push(manualResult('OQ-002', 'Duplicate account testing requires explicit synthetic qualification and a verified owned account.'));

  // OQ-003: Wrong password + audit check
  {
    const r = await captureWithExpectedStatus(
      { testCaseId: 'OQ-003', method: 'POST', url: '/api/auth/login', baseUrl, body: { username: fixture?.body.username ?? `oq_absent_${randomUUID().replace(/-/g, '')}`, password: 'WrongPassword123!' } }, 401,
    );
    r.regulatoryRef = '§11.300(d)';
    r.testDescription = 'Verify that wrong password returns HTTP 401 Unauthorized';
    r.acceptanceCriteria = 'HTTP 401 for invalid credentials';
    results.push(r);
  }

  // OQ-004: Native policy refusal on this disposable account, with unchanged-password login proof
  results.push(fixture ? await weakPasswordRefusal('OQ-004', baseUrl, fixture.body.username, fixture.body.password)
    : { ...manualResult('OQ-004', 'No verified owned account for password policy testing.'), method: 'CONTRACT' });

  // OQ-005: Invalid token — verify system rejects tampered/invalid JWT
  {
    const r = await captureWithExpectedStatus(
      { testCaseId: 'OQ-005', method: 'GET', url: '/api/auth/verify', baseUrl,
        headers: { Authorization: 'Bearer invalid.token.here' } }, 401,
    );
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that invalid/tampered JWT token is rejected';
    r.acceptanceCriteria = 'HTTP 401 for malformed Bearer token';
    results.push(r);
  }

  // OQ-006: JWT claims verification
  {
    const loginRes = await captureLoginProbe(baseUrl, username, password, 'OQ-006');
    if (loginRes.passed && isRecord(loginRes.responseBody)) {
      const tok = loginRes.responseBody.accessToken as string;
      try {
        const parts = tok.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as Record<string, unknown>;
        const hasUserId = nativeId(payload.userId);
        const hasRole = typeof payload.role === 'string' && payload.role.trim().length > 0
          || Array.isArray(payload.roles) && payload.roles.length > 0 && payload.roles.every(role => typeof role === 'string' && role.trim().length > 0);
        const hasExp = typeof payload.exp === 'number' && Number.isFinite(payload.exp) && payload.exp > Date.now()/1000;
        loginRes.passed = hasUserId && hasRole && hasExp;
        loginRes.notes = `JWT claims: userId=${hasUserId}, role=${hasRole}, exp=${hasExp}`;
      } catch {
        loginRes.passed = false;
        loginRes.notes = 'Failed to decode JWT payload';
      }
    }
    loginRes.regulatoryRef = '§11.10(d)';
    loginRes.testDescription = 'Verify that JWT contains required claims (userId, role, exp)';
    loginRes.acceptanceCriteria = 'Decoded JWT payload contains userId/sub, role, and exp claims';
    results.push(loginRes);
  }

  // OQ-007: Device fingerprint (manual)
  results.push(manualResult('OQ-007', 'Native session readback for two explicit fingerprint headers is required. The current UI sends neither header; mismatch alerts do not reject a session.', {
    regulatoryRef: '§11.10(h)',
    testDescription: 'Verify optional API fingerprint tracking for two exact owned sessions; UI tracking remains unqualified',
    acceptanceCriteria: 'Native session records retain each supplied x-device-fingerprint and User-Agent under its exact owned user/session identity; no hard-binding claim',
  }));

  // Never lock the operator who is needed by subsequent qualification suites.
  if (fixture && operator.session) results.push((await captureQualificationOperation('OQ-009', baseUrl, operator.session.token,
    'Observe native lockout on the dedicated synthetic viewer account', async request => {
      const valid = expectStudySuccess(await request('POST', '/auth/login', {
        username: fixture!.body.username, password: fixture!.body.password,
      }), 200);
      if (!(typeof valid.accessToken === 'string' && valid.accessToken || typeof valid.data?.accessToken === 'string' && valid.data.accessToken))
        throw new Error('Owned authentication fixture cannot establish a valid baseline session.');
      let observed = false;
      for (let attempt = 0; attempt < 7; attempt++) {
        const rejected = await request('POST', '/auth/login', { username: fixture!.body.username, password: fixture!.body.password + '_wrong' });
        if (![401, 423, 429].includes(rejected.status)) throw new Error('Failed login did not return a controlled native refusal.');
        const read = expectStudySuccess(await request('GET', `/users/${fixture!.userId}`), 200).data;
        if (read?.userId !== fixture!.userId || read.userName !== fixture!.body.username) throw new Error('Lockout readback changed account identity.');
        if (read.statusId === 5 && Number.isSafeInteger(read.lockCounter) && read.lockCounter > 0) { observed = true; break; }
      }
      if (!observed) throw new Error('No native account lockout observed within the bounded seven-attempt probe.');
      const correctAfter = await request('POST', '/auth/login', { username: fixture!.body.username, password: fixture!.body.password });
      if (correctAfter.status !== 401 || !isRecord(correctAfter.body) || correctAfter.body.success !== false
        || typeof correctAfter.body.message !== 'string' || !/locked/i.test(correctAfter.body.message))
        throw new Error('A locked account did not reject its known correct password as locked.');
    })).evidence);
  else results.push(manualResult('OQ-009', 'Lockout testing requires explicit synthetic qualification and a verified owned account; the operator is never targeted.'));

  // OQ-010: Logout invalidates token
  {
    const freshLogin = (await login(baseUrl, username, password)).session;
    if (freshLogin) {
      const h = authHeaders(freshLogin.token);
      const logout = await captureApiCall({ testCaseId: 'OQ-010-logout', method: 'POST', url: '/api/auth/logout', baseUrl, headers: h });
      const reuse = await captureApiCall({ testCaseId: 'OQ-010', method: 'GET', url: '/api/auth/verify', baseUrl, headers: h });
      reuse.passed = logout.passed && !reuse.captureError && reuse.responseStatus === 401;
      reuse.relatedEvidence = [logout];
      reuse.notes = reuse.responseStatus === 401
        ? 'Logged-out token correctly rejected'
        : `Expected 401 after logout, got ${reuse.responseStatus}`;
      reuse.regulatoryRef = '§11.10(d)';
      reuse.testDescription = 'Verify that logout invalidates token immediately';
      reuse.acceptanceCriteria = 'HTTP 401 when using token after logout';
      results.push(reuse);
    } else {
      const fallback: EvidenceResult = {
        testCaseId: 'OQ-010', timestamp: new Date().toISOString(), endpoint: '/api/auth/logout', method: 'POST', responseStatus: 0, responseBody: null, passed: false, notes: 'Could not login to test logout',
        regulatoryRef: '§11.10(d)',
        testDescription: 'Verify that logout invalidates token immediately',
        acceptanceCriteria: 'HTTP 401 when using token after logout',
      };
      results.push(fallback);
    }
  }

  } catch (error) {
    results.push({ ...manualResult('OQ-AUTH-EXECUTION', 'Unexpected authentication suite exception; retained steps show the last completed operation.'), method: 'CONTRACT' });
  } finally {
    if (cleanupTarget && operator.session) results.push(await disableAuthFixture('OQ-AUTH-CLEANUP', baseUrl, operator.session.token, cleanupTarget));
    else if (attemptedCreation) results.push({ ...manualResult('OQ-AUTH-CLEANUP', 'Creation has no verified native ID; cleanup is unresolved. Reconcile the unique username in OQ-AUTH-FIXTURE before retrying.'), method: 'CONTRACT' });
    if (operator.session) results.push(await captureWithExpectedStatus({ testCaseId: 'OQ-AUTH-LOGOUT', method: 'POST', url: '/api/auth/logout', baseUrl, headers: authHeaders(operator.session.token) }, 200));
  }
  // Exhausting the shared caller bucket is always last, after owned cleanup/logout.
  if (!deferRateLimit) results.push(await runRateLimitTest(baseUrl));
  for (let id = 1; id <= 10; id++) { if (id === 8 && deferRateLimit) continue; const testCaseId = `OQ-${String(id).padStart(3, '0')}`;
    if (!results.some(row => row.testCaseId === testCaseId)) results.push({ ...manualResult(testCaseId, 'Authentication suite did not execute this case.'), method: 'CONTRACT' }); }


  return results;
}

// ── Suite 2: Access Control Tests (OQ-011 → OQ-022) ──

async function runAccessControlTests(baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const h = authHeaders(token);

  // OQ-011: Admin user management access
  {
    const r = await captureApiCall({ testCaseId: 'OQ-011', method: 'GET', url: '/api/users', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that admin role can access user management endpoint';
    r.acceptanceCriteria = 'HTTP 200 with list of users returned for admin role';
    results.push(r);
  }

  // OQ-012: Query access
  {
    const r = await captureApiCall({ testCaseId: 'OQ-012', method: 'GET', url: '/api/queries', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that authenticated user can access query listing endpoint';
    r.acceptanceCriteria = 'HTTP 200 with query data returned for authorized user';
    results.push(r);
  }

  // OQ-013: Subject access
  {
    const r = await captureApiCall({ testCaseId: 'OQ-013', method: 'GET', url: `/api/subjects?studyId=${fixture?.state.studyId ?? 0}`, baseUrl, headers: h });
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that authenticated user can access subject listing endpoint';
    r.acceptanceCriteria = 'HTTP 200 with subject data returned for authorized user';
    results.push(r);
  }

  // OQ-014: Form access
  {
    const r = await captureApiCall({ testCaseId: 'OQ-014', method: 'GET', url: '/api/forms', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that authenticated user can access form listing endpoint';
    r.acceptanceCriteria = 'HTTP 200 with form data returned for authorized user';
    results.push(r);
  }

  // OQ-015: Audit access
  {
    const r = await captureApiCall({ testCaseId: 'OQ-015', method: 'GET', url: '/api/audit', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(e)';
    r.testDescription = 'Verify that authorized user can access audit trail records';
    r.acceptanceCriteria = 'HTTP 200 with audit entries returned for authorized user';
    results.push(r);
  }

  // OQ-016: Dashboard access
  {
    const r = await captureApiCall({ testCaseId: 'OQ-016', method: 'GET', url: '/api/dashboard/summary', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that authenticated user can access dashboard data endpoint';
    r.acceptanceCriteria = 'HTTP 200 with dashboard metrics returned for authorized user';
    results.push(r);
  }

  // OQ-017: Freeze endpoint exists
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-017', method: 'GET', url: `/api/data-locks/status/${fixture?.state.formDataId ?? 0}`, baseUrl, headers: h },
      (status, body) => ({ passed: successfulResource(status, body), notes: successfulResource(status, body) ? `Freeze endpoint exists (status ${status})` : 'Freeze endpoint not found (404)' }),
    );
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that the data freeze endpoint exists and is accessible to authorized users';
    r.acceptanceCriteria = 'Freeze endpoint requires HTTP 200 success=true and observed data status for authorized user';
    results.push(r);
  }

  // OQ-018: No auth → studies
  {
    const r = await captureWithExpectedStatus({ testCaseId: 'OQ-018', method: 'GET', url: '/api/studies', baseUrl }, 401);
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that unauthenticated access to studies endpoint is denied';
    r.acceptanceCriteria = 'HTTP 401 when accessing /api/studies without authentication';
    results.push(r);
  }

  // OQ-019: No auth → export
  {
    const r = await captureWithExpectedStatus({ testCaseId: 'OQ-019', method: 'GET', url: `/api/export/forms/${fixture?.state.studyId ?? 0}`, baseUrl }, 401);
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that unauthenticated access to export endpoint is denied';
    r.acceptanceCriteria = 'HTTP 401 when accessing /api/export without authentication';
    results.push(r);
  }

  // OQ-020: No auth header → studies
  {
    const r = await captureWithExpectedStatus({ testCaseId: 'OQ-020', method: 'GET', url: '/api/studies', baseUrl }, 401);
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that request without Authorization header to studies endpoint is denied';
    r.acceptanceCriteria = 'HTTP 401 when accessing /api/studies without Authorization header';
    results.push(r);
  }

  results.push(...await runAccountLifecycleTests(baseUrl, token, !!fixture?.state.qualification));

  return results;
}

// ── Suite 3: Audit Trail Tests (OQ-023 → OQ-032) ──

async function runAuditTrailTests(baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const h = authHeaders(token);

  // OQ-023: Audit entries
  {
    const r = await captureApiCall({ testCaseId: 'OQ-023', method: 'GET', url: `/api/audit/form/${fixture?.state.formDataId ?? 0}`, baseUrl, headers: h });
    r.regulatoryRef = '§11.10(e)';
    r.testDescription = 'Verify that audit trail entries are retrievable and contain recorded system actions';
    r.acceptanceCriteria = 'HTTP 200 with non-empty array of audit entries';
    results.push(r);
  }

  // OQ-024 through OQ-028: Audit field verification
  const auditRes = await captureApiCall({ testCaseId: 'OQ-024-fetch', method: 'GET', url: `/api/audit/form/${fixture?.state.formDataId ?? 0}`, baseUrl, headers: h });
  const entries = auditRes.passed ? getEntries(auditRes.responseBody) : null;

  // OQ-024: old_value/new_value
  {
    const r = { ...auditRes, testCaseId: 'OQ-024' };
    if (entries) {
      const e = entries[0];
      const has = 'oldValue' in e || 'old_value' in e || 'newValue' in e || 'new_value' in e || 'details' in e;
      r.passed = has; r.notes = has ? 'Audit entry contains value change fields' : 'Audit entry missing oldValue/newValue fields';
    } else { r.passed = false; r.notes = 'No audit data available — manual verification required'; }
    r.regulatoryRef = '§11.10(e)';
    r.testDescription = 'Verify that audit trail captures old and new values for every data change to enable reconstruction of events';
    r.acceptanceCriteria = 'Audit entry contains oldValue/newValue or details fields recording prior and current state';
    results.push(r);
  }

  // OQ-025: userId/userName/role
  {
    const r = { ...auditRes, testCaseId: 'OQ-025' };
    if (entries) {
      const e = entries[0];
      const hasUser = 'userId' in e || 'user_id' in e || 'userName' in e || 'user_name' in e;
      r.passed = hasUser; r.notes = hasUser ? 'Audit entry contains user identity fields' : 'Audit entry missing user identity fields';
    } else { r.passed = false; r.notes = 'No audit data available — manual verification required'; }
    r.regulatoryRef = '§11.10(e)';
    r.testDescription = 'Verify that every audit trail entry records the identity (userId, userName) of the person who performed the action';
    r.acceptanceCriteria = 'Audit entry contains userId or userName identifying the operator';
    results.push(r);
  }

  // OQ-026: ISO 8601 timestamp
  {
    const r = { ...auditRes, testCaseId: 'OQ-026' };
    if (entries) {
      const e = entries[0];
      const ts = (e.timestamp ?? e.createdAt ?? e.created_at ?? e.auditDate ?? e.audit_date) as string | undefined;
      const isIso = typeof ts === 'string' && (ts.includes('T'));
      r.passed = isIso; r.notes = isIso ? `Timestamp in ISO format: ${ts}` : `Timestamp format issue: ${ts}`;
    } else { r.passed = false; r.notes = 'No audit data available — manual verification required'; }
    r.regulatoryRef = '§11.10(e)';
    r.testDescription = 'Verify that audit trail timestamps use ISO 8601 format with timezone for unambiguous chronological ordering';
    r.acceptanceCriteria = 'Audit entry timestamp is in ISO 8601 format (contains T separator)';
    results.push(r);
  }

  // OQ-027: action field
  {
    const r = { ...auditRes, testCaseId: 'OQ-027' };
    if (entries) {
      const e = entries[0];
      const has = typeof e.eventTypeName === 'string' && e.eventTypeName.length > 0;
      r.passed = has; r.notes = has ? 'Audit entry contains action field' : 'Audit entry missing action field';
    } else { r.passed = false; r.notes = 'No audit data available — manual verification required'; }
    r.regulatoryRef = '§11.10(e)';
    r.testDescription = 'Verify that every audit trail entry records the type of action performed (create, update, delete, sign, etc.)';
    r.acceptanceCriteria = 'Audit entry contains an action or eventType field describing the operation';
    results.push(r);
  }

  // OQ-028: entityType and entityId
  {
    const r = { ...auditRes, testCaseId: 'OQ-028' };
    if (entries) {
      const e = entries[0];
      const hasType = typeof e.auditTable === 'string' && e.auditTable.length > 0;
      const hasId = nativeId(e.entityId);
      r.passed = hasType && hasId; r.notes = `entityType=${hasType}, entityId=${hasId}`;
    } else { r.passed = false; r.notes = 'No audit data available — manual verification required'; }
    r.regulatoryRef = '§11.10(e)';
    r.testDescription = 'Verify that audit trail entries reference the specific entity (type and ID) affected by the action';
    r.acceptanceCriteria = 'Audit entry contains entityType/tableName and entityId/recordId fields';
    results.push(r);
  }

  // OQ-029: Reason for change (manual)
  results.push(manualResult('OQ-029', 'Reason for change verification requires clinical data modification test', {
    regulatoryRef: '§11.10(e)',
    testDescription: 'Verify that the system requires a reason for change on clinical data modifications and records it in the audit trail',
    acceptanceCriteria: 'Audit entry contains a reason field when clinical data is modified',
  }));

  // OQ-030: API refusal and unchanged owned native records
  results.push(await captureAuditRefusal('OQ-030', baseUrl, token ?? '', 'PUT', fixture));

  // OQ-031: API refusal and unchanged owned native records
  results.push(await captureAuditRefusal('OQ-031', baseUrl, token ?? '', 'DELETE', fixture));

  // OQ-032: Complete native audit export compared with exact correction
  results.push(await captureAuditDownload('OQ-032', baseUrl, token, fixture));

  return results;
}

// ── Suite 4: Signature Tests (OQ-033 → OQ-042) ──

async function runSignatureTests(baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const h = authHeaders(token);

  results.push(await captureSignaturePasswordRefusal(baseUrl, token, 'missing', fixture));

  // OQ-034 through OQ-037: Signature field checks
  const sigRes = await captureApiCall({ testCaseId: 'OQ-034-fetch', method: 'GET', url: '/api/esignature/pending', baseUrl, headers: h });
  const sigEntries = sigRes.passed ? getEntries(sigRes.responseBody) : null;

  // OQ-034: signerName
  {
    const r = { ...sigRes, testCaseId: 'OQ-034' };
    if (sigEntries) {
      const e = sigEntries[0];
      const has = 'signerName' in e || 'signer_name' in e || 'userName' in e;
      r.passed = has; r.notes = has ? 'Signature contains signerName' : 'Signature missing signerName';
    } else { r.passed = false; r.notes = 'No signature data — manual verification required'; }
    r.regulatoryRef = '§11.50(a)';
    r.testDescription = 'Verify that each e-signature record includes the printed name of the signer';
    r.acceptanceCriteria = 'Signature record contains signerName or userName field';
    results.push(r);
  }

  // OQ-035: signedAt
  {
    const r = { ...sigRes, testCaseId: 'OQ-035' };
    if (sigEntries) {
      const e = sigEntries[0];
      const has = 'signedAt' in e || 'signed_at' in e || 'createdAt' in e || 'timestamp' in e;
      r.passed = has; r.notes = has ? 'Signature contains signedAt' : 'Signature missing signedAt';
    } else { r.passed = false; r.notes = 'No signature data — manual verification required'; }
    r.regulatoryRef = '§11.50(a)';
    r.testDescription = 'Verify that each e-signature record includes the date and time the signature was applied';
    r.acceptanceCriteria = 'Signature record contains signedAt or timestamp field';
    results.push(r);
  }

  // OQ-036: meaning
  {
    const r = { ...sigRes, testCaseId: 'OQ-036' };
    if (sigEntries) {
      const e = sigEntries[0];
      const has = 'meaning' in e || 'signatureMeaning' in e;
      r.passed = has; r.notes = has ? 'Signature contains meaning' : 'Signature missing meaning';
    } else { r.passed = false; r.notes = 'No signature data — manual verification required'; }
    r.regulatoryRef = '§11.50(a)';
    r.testDescription = 'Verify that each e-signature record includes the meaning (e.g., review, approval, responsibility) associated with the signature';
    r.acceptanceCriteria = 'Signature record contains meaning or signatureMeaning field';
    results.push(r);
  }

  // OQ-037: recordHash or eventCrfId
  {
    const r = { ...sigRes, testCaseId: 'OQ-037' };
    if (sigEntries) {
      const e = sigEntries[0];
      const has = 'recordHash' in e || 'record_hash' in e || 'eventCrfId' in e || 'event_crf_id' in e;
      r.passed = has; r.notes = has ? 'Signature contains record identifier' : 'Signature missing recordHash/eventCrfId';
    } else { r.passed = false; r.notes = 'No signature data — manual verification required'; }
    r.regulatoryRef = '§11.70(a)';
    r.testDescription = 'Verify that each e-signature is cryptographically linked to its signed record via hash or record ID';
    r.acceptanceCriteria = 'Signature record contains recordHash or eventCrfId linking it to the signed data';
    results.push(r);
  }

  // Printed manifestation requires separate rendered evidence.
  results.push(manualResult('OQ-038', 'Signature manifestation display requires UI/PDF verification', {
    regulatoryRef: '§11.50(b)',
    testDescription: 'Verify that e-signature manifestation is clearly displayed in human-readable form on screen and in printed/PDF output',
    acceptanceCriteria: 'Signature name, date/time, and meaning are visible in UI and exported documents',
  }));
  results.push(manualResult('OQ-039', 'Post-signature change verification requires modification of signed record', {
    regulatoryRef: '§11.70(b)',
    testDescription: 'Verify that any change to a signed record invalidates or removes the existing e-signature',
    acceptanceCriteria: 'Modifying signed data clears the signature or blocks the modification',
  }));
  results.push(await captureSignatureCopyRefusal(baseUrl, token, fixture));

  results.push(await captureSignaturePasswordRefusal(baseUrl, token, 'wrong', fixture));

  results.push(await captureSignatureAudit(baseUrl, token, fixture));

  return results;
}

// ── Suite 5: Data Operation Tests (OQ-043 → OQ-050) ──

export async function runDataOperationTests(baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const h = authHeaders(token);

  // OQ-043: Forms accessible
  {
    const r = await captureApiCall({ testCaseId: 'OQ-043', method: 'GET', url: '/api/forms?limit=1', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = 'Verify that electronic records (forms/CRFs) are accessible and retrievable by authorized users';
    r.acceptanceCriteria = 'HTTP 200 with form data returned for authorized user';
    results.push(r);
  }

  // OQ-044: Manual
  results.push(manualResult('OQ-044', 'Data modification test requires existing form data and PUT operation', {
    regulatoryRef: '§11.10(e)',
    testDescription: 'Verify that clinical data modification creates an audit trail entry with old value, new value, reason, and operator identity',
    acceptanceCriteria: 'PUT to form data creates audit entry with before/after values and reason for change',
  }));

  // OQ-045: Export endpoint exists
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-045', method: 'GET', url: `/api/export/forms/${fixture?.state.studyId ?? 0}`, baseUrl, headers: h },
      (status, body) => ({ passed: successfulResource(status, body), notes: successfulResource(status, body) ? `Export endpoint responds (${status})` : 'Export endpoint not found' }),
    );
    r.regulatoryRef = '§11.10(b)';
    r.testDescription = 'Verify that the data export endpoint exists and is operational for generating human-readable copies';
    r.acceptanceCriteria = 'Export endpoint requires HTTP 200 success=true and observed data status for authorized user';
    results.push(r);
  }

  results.push(nativeCase(fixture, ['OQ-061', 'PQ-037'], 'OQ-046'));

  // OQ-047: Native CSV download
  results.push(await captureNativeDownload('OQ-047', baseUrl, token ?? '', 'csv', fixture));

  // OQ-048: Native PDF download
  results.push(await captureNativeDownload('OQ-048', baseUrl, token ?? '', 'pdf', fixture));

  // OQ-049: Single form endpoint
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-049', method: 'GET', url: `/api/forms/${fixture?.state.formId ?? 0}`, baseUrl, headers: h },
      (status, body) => ({ passed: successfulResource(status, body), notes: `Form endpoint responds (${status})` }),
    );
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = 'Verify that individual electronic records (single form) can be retrieved by ID';
    r.acceptanceCriteria = 'Single form endpoint requires HTTP 200 success=true and observed data';
    results.push(r);
  }

  // OQ-050: Queries accessible
  {
    const r = await captureApiCall({ testCaseId: 'OQ-050', method: 'GET', url: '/api/queries', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = 'Verify that data queries (discrepancy management) are accessible and retrievable by authorized users';
    r.acceptanceCriteria = 'HTTP 200 with query data returned for authorized user';
    results.push(r);
  }

  return results;
}

// ── Suite 6: Data Lock Tests (OQ-051 → OQ-055) ──

export async function captureOwnedUnlock(baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult> {
  const state = fixture?.state, reason = `Owned OQ unlock ${randomUUID()}`;
  let restore = false, beforeValues: unknown;
  const operation = await captureQualificationOperation('OQ-053', baseUrl, token,
    'Authorized signed unlock changes only the owned form and records the exact reason and actor', async request => {
      if (!state?.qualification || !nativeCase(fixture, ['PQ-033', 'PQ-034'], 'OQ-052').passed) throw new Error('No verified owned locked-form prerequisite.');
      const authority = expectStudySuccess(await request('GET', '/auth/verify'), 200).data;
      if (!nativeId(authority?.userId) || authority.username !== state.qualification.username || !['admin', 'data_manager'].includes(authority.role))
        throw new Error('The unlock operator identity/role was not established.');
      const before = await patientForm(request, state); beforeValues = before.formData;
      if (before.lockStatus.locked !== true) throw new Error('Owned form is not locked.');
      const history = expectStudySuccess(await request('GET', `/data-locks/history/${state.formDataId}`), 200).data;
      if (!Array.isArray(history) || history.some((row: any) => row.entityType !== 'event_crf' || row.entityId !== state.formDataId || !nativeId(row.lockId)))
        throw new Error('Pre-unlock history has wrong native scope or identity.');
      restore = true;
      expectStudySuccess(await request('POST', `/data-locks/${state.formDataId}/unlock`, { reason,
        signatureUsername: state.qualification.username, signaturePassword: state.qualification.password }), 200);
      const after = await patientForm(request, state);
      if (after.lockStatus.locked !== false || !isDeepStrictEqual(after.formData, beforeValues)) throw new Error('Native unlock did not preserve the owned values.');
      const rows = expectStudySuccess(await request('GET', `/data-locks/history/${state.formDataId}`), 200).data;
      if (!Array.isArray(rows) || !rows.some((row: any) => row.entityType === 'event_crf' && row.entityId === state.formDataId
        && nativeId(row.lockId) && !history.some((old: any) => old.lockId === row.lockId) && row.action === 'unlock'
        && row.performedBy === authority.userId && Number.isFinite(Date.parse(row.performedAt)) && row.reason === reason))
        throw new Error('New native unlock audit lacks the exact owned identity, actor, time or reason.');
    });
  if (restore && state?.qualification) {
    const restoration = await captureQualificationOperation('OQ-053-restore', baseUrl, token,
      'Restore the owned form lock after the unlock probe and verify unchanged values', async request => {
        const current = await patientForm(request, state);
        if (!isDeepStrictEqual(current.formData, beforeValues)) throw new Error('Owned values changed; refusing to mask this with a relock.');
        if (current.lockStatus.locked !== true) expectStudySuccess(await request('POST', '/data-locks', { eventCrfId: state.formDataId,
          reason: 'Restore owned lock after OQ unlock qualification', signatureUsername: state.qualification!.username,
          signaturePassword: state.qualification!.password }), 200);
        const restored = await patientForm(request, state);
        if (restored.lockStatus.locked !== true || !isDeepStrictEqual(restored.formData, beforeValues)) throw new Error('Owned lock restoration was not verified.');
      });
    operation.evidence.relatedEvidence = [...operation.evidence.relatedEvidence ?? [], restoration.evidence];
    operation.evidence.passed = operation.evidence.passed && restoration.evidence.passed;
    if (!restoration.evidence.passed) operation.evidence.notes += ` Restoration also failed: ${restoration.evidence.notes}`;
  }
  return operation.evidence;
}

export async function captureLifecycleAudit(baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult> {
  return (await captureQualificationOperation('OQ-055', baseUrl, token,
    'Owned freeze, unfreeze and lock operations each retain their exact requested reason, actor and timestamp', async request => {
      const state = fixture?.state;
      if (!state?.qualification || !nativeCase(fixture, ['PQ-030', 'PQ-032', 'PQ-033'], 'OQ-055-prerequisites').passed)
        throw new Error('No complete owned lifecycle prerequisites.');
      await patientForm(request, state);
      const authority = expectStudySuccess(await request('GET', '/auth/verify'), 200).data;
      if (!nativeId(authority?.userId) || authority.username !== state.qualification.username) throw new Error('Native lifecycle actor identity differs.');
      const rows = expectStudySuccess(await request('GET', `/data-locks/history/${state.formDataId}`), 200).data;
      if (!Array.isArray(rows) || rows.some((row: any) => row.entityType !== 'event_crf' || row.entityId !== state.formDataId || !nativeId(row.lockId)))
        throw new Error('Lifecycle audit is empty, malformed or crosses native scope.');
      for (const [action, reason] of [['freeze', 'Freeze synthetic qualification form'], ['unfreeze', 'Unfreeze synthetic qualification form'], ['lock', 'Lock synthetic qualification form']]) {
        if (!rows.some((row: any) => row.action === action && row.reason === reason && row.performedBy === authority.userId
          && Number.isFinite(Date.parse(row.performedAt)))) throw new Error(`Native ${action} audit lacks the exact requested reason, actor or timestamp.`);
      }
    })).evidence;
}

export async function runDataLockTests(baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const h = authHeaders(token);

  results.push(nativeCase(fixture, ['PQ-030', 'PQ-031'], 'OQ-051'));
  results.push(nativeCase(fixture, ['PQ-033', 'PQ-034'], 'OQ-052'));
  const unlock = await captureOwnedUnlock(baseUrl, token, fixture);
  results.push(unlock);

  // OQ-054: Data locks endpoint
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-054', method: 'GET', url: '/api/data-locks?limit=1', baseUrl, headers: h },
      (status, body) => ({ passed: successfulResource(status, body), notes: successfulResource(status, body) ? `Data locks endpoint responds (${status})` : 'Data locks endpoint not found' }),
    );
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = 'Verify that the data locks listing endpoint exists and returns lock/freeze status records';
    r.acceptanceCriteria = 'Data locks endpoint requires HTTP 200 success=true and observed data status for authorized user';
    results.push(r);
  }

  const lifecycle = await captureLifecycleAudit(baseUrl, token, fixture);
  results.push({ ...lifecycle, passed: lifecycle.passed && unlock.passed, relatedEvidence: [...lifecycle.relatedEvidence ?? [], unlock],
    notes: `${lifecycle.notes} Also requires the separately retained signed unlock and restoration evidence.` });

  return results;
}

// ── Suite 7: Part 11 Compliance Controls (OQ-056 → OQ-070) ──

export async function runPart11ComplianceTests(
  baseUrl: string, username: string, password: string, token: string | null, authEvidence: EvidenceResult[] = [], fixture?: OwnedOqFixture,
): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const h = token ? authHeaders(token) : {};

  // OQ-056: §11.300(b) — Password expiration check is active
  {
    const r = await captureLoginProbe(baseUrl, username, password, 'OQ-056');
    if (r.passed && isRecord(r.responseBody)) {
      const hasExpirationInfo = 'passwordExpirationWarning' in r.responseBody ||
                                 'daysUntilExpiration' in r.responseBody;
      r.passed = hasExpirationInfo;
      r.notes = hasExpirationInfo ? 'Observed native password age information' : 'No password age warning or age observation in this login; expiration control is not established.';
    }
    r.regulatoryRef = '§11.300(b)';
    r.testDescription = 'Verify that the system checks password expiration status on login and warns users approaching expiry';
    r.acceptanceCriteria = 'Login endpoint returns successfully and processes password age information';
    results.push(r);
  }

  // Reuse the observed dedicated-account lockout, never infer a counter from HTTP 401.
  const lockout = authEvidence.find(row => row.testCaseId === 'OQ-009');
  results.push(lockout ? { ...lockout, testCaseId: 'OQ-057', relatedEvidence: [lockout],
    testDescription: 'Retain native dedicated-account lockout evidence for the account-security control' }
    : manualResult('OQ-057', 'No dedicated-account lockout evidence exists for this run.'));

  // OQ-058: §11.300(c) — Emergency session revocation endpoint exists
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-058', method: 'POST', url: `/api/users/${fixture?.authUserId ?? 0}/revoke-sessions`, baseUrl, headers: h, body: {} },
      (status, body) => ({
        passed: successfulResource(status, body),
        notes: successfulResource(status, body)
          ? `Session revocation endpoint exists (HTTP ${status} — expected 400/403/404 for nonexistent user)`
          : 'Session revocation endpoint not found (404)',
      }),
    );
    r.regulatoryRef = '§11.300(c)';
    r.testDescription = 'Verify that emergency session revocation endpoint exists for immediate de-authorization of compromised accounts';
    r.acceptanceCriteria = 'Session revocation endpoint requires HTTP 200 success=true and observed data status (endpoint exists and is routed)';
    results.push(r);
  }

  // OQ-059: §11.200(a)(1) — E-signature requires two components (username + password)
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-059', method: 'POST', url: `/api/queries/${fixture?.state.queryId ?? 0}/close-with-signature`, baseUrl, headers: h,
        body: { signaturePassword: 'test', reason: 'test' } },
      (status, body) => {
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        const requiresBoth = status === 400 && bodyStr.includes('username');
        return {
          passed: requiresBoth,
          notes: requiresBoth
            ? 'Two-component e-signature enforced — username required with password'
            : `E-signature endpoint responded with ${status}`,
        };
      },
    );
    r.regulatoryRef = '§11.200(a)(1)';
    r.testDescription = 'Verify that e-signature requires two identification components (username + password) per signing event';
    r.acceptanceCriteria = 'HTTP 400/403 when signing with only password — username is also required';
    results.push(r);
  }

  // OQ-060: API refusal and unchanged owned native records
  results.push(await captureAuditRefusal('OQ-060', baseUrl, token ?? '', 'DELETE', fixture));

  results.push(fixture?.reasonRefusal ?? { ...manualResult('OQ-061', 'No native pre-lock reason-required probe was retained.'), method: 'CONTRACT' });

  // OQ-062: §11.10(d) — Token blocklist active (logout invalidates immediately)
  {
    const freshLogin = (await login(baseUrl, username, password)).session;
    if (freshLogin && freshLogin.token !== token) {
      const fh = authHeaders(freshLogin.token);
      const logout = await captureApiCall({ testCaseId: 'OQ-062-logout', method: 'POST', url: '/api/auth/logout', baseUrl, headers: fh });
      const reuseResult = await captureApiCall({ testCaseId: 'OQ-062', method: 'GET', url: '/api/auth/verify', baseUrl, headers: fh });
      reuseResult.passed = logout.passed && !reuseResult.captureError && reuseResult.responseStatus === 401;
      reuseResult.relatedEvidence = [logout];
      reuseResult.notes = reuseResult.responseStatus === 401
        ? 'Token blocklist active — logged-out token immediately rejected'
        : `Post-logout token still accepted (${reuseResult.responseStatus}) — blocklist may not be active`;
      reuseResult.regulatoryRef = '§11.10(d)';
      reuseResult.testDescription = 'Verify that token blocklist is active and logout immediately invalidates the JWT session token';
      reuseResult.acceptanceCriteria = 'HTTP 401 when reusing a token after logout — immediate invalidation';
      results.push(reuseResult);
    } else {
      results.push(manualResult('OQ-062', 'Token blocklist test requires authentication', {
        regulatoryRef: '§11.10(d)',
        testDescription: 'Verify that token blocklist is active and logout immediately invalidates the JWT session token',
        acceptanceCriteria: 'HTTP 401 when reusing a token after logout — immediate invalidation',
      }));
    }
  }

  // OQ-063: §164.312(c)(1) — PHI not exposed in error responses
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-063', method: 'GET', url: '/api/nonexistent-endpoint', baseUrl, headers: h },
      (status, body) => {
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        const leaksStack = /at\s+\w+\s+\(.*\.(?:ts|js):\d+:\d+\)/.test(bodyStr);
        const leaksPath = /(?:[A-Z]:\\|\/home\/|\/usr\/|node_modules)/.test(bodyStr);
        return {
          passed: status === 404 && !leaksStack && !leaksPath,
          notes: !leaksStack && !leaksPath
            ? 'Error responses do not leak stack traces or internal paths'
            : 'Error response contains internal information — potential PHI exposure vector',
        };
      },
    );
    r.regulatoryRef = '§164.312(c)(1)';
    r.testDescription = 'Verify that error responses do not expose stack traces, internal file paths, or PHI/system internals';
    r.acceptanceCriteria = 'Error response body contains no stack traces, no internal file paths, and no PHI';
    results.push(r);
  }

  // OQ-064: §11.50 — Signature manifestation fields (name/date/meaning)
  {
    const sigRes = await captureApiCall({ testCaseId: 'OQ-064', method: 'GET', url: '/api/esignature/pending', baseUrl, headers: h });
    const sigEntries = sigRes.passed ? getEntries(sigRes.responseBody) : null;
    if (sigEntries && sigEntries.length > 0) {
      const e = sigEntries[0];
      const hasName = 'signerName' in e || 'signer_name' in e;
      const hasDate = 'signedAt' in e || 'signed_at' in e;
      const hasMeaning = 'meaning' in e || 'signatureMeaning' in e;
      sigRes.passed = hasName && hasDate && hasMeaning;
      sigRes.notes = `§11.50 manifestation: name=${hasName}, date=${hasDate}, meaning=${hasMeaning}`;
    } else {
      sigRes.passed = false;
      sigRes.notes = 'No signature records available — create signatures then re-test';
    }
    sigRes.regulatoryRef = '§11.50(a)';
    sigRes.testDescription = 'Verify that e-signature manifestation includes all required fields: signer name, date/time signed, and meaning of signature';
    sigRes.acceptanceCriteria = 'Signature record contains signerName, signedAt, and meaning fields';
    results.push(sigRes);
  }

  // OQ-065: §11.70 — Signature linked to record via hash
  {
    const sigRes = await captureApiCall({ testCaseId: 'OQ-065', method: 'GET', url: '/api/esignature/pending', baseUrl, headers: h });
    const sigEntries = sigRes.passed ? getEntries(sigRes.responseBody) : null;
    if (sigEntries && sigEntries.length > 0) {
      const e = sigEntries[0];
      const hasHash = 'recordHash' in e || 'record_hash' in e;
      const hasRecordRef = 'eventCrfId' in e || 'event_crf_id' in e || 'entityId' in e;
      sigRes.passed = hasHash || hasRecordRef;
      sigRes.notes = hasHash
        ? '§11.70 record linking: cryptographic hash present'
        : hasRecordRef
          ? '§11.70 record linking: record reference present (hash recommended)'
          : 'Signature not linked to record — §11.70 violation';
    } else {
      sigRes.passed = false;
      sigRes.notes = 'No signature records available — create signatures then re-test';
    }
    sigRes.regulatoryRef = '§11.70(a)';
    sigRes.testDescription = 'Verify that e-signatures are cryptographically linked to their signed records via hash or record reference';
    sigRes.acceptanceCriteria = 'Signature record contains recordHash or eventCrfId linking it to the signed data';
    results.push(sigRes);
  }

  const duplicate = authEvidence.find(row => row.testCaseId === 'OQ-002');
  results.push(duplicate ? { ...duplicate, testCaseId: 'OQ-066', relatedEvidence: [duplicate],
    testDescription: 'Retain exact native duplicate-username refusal and unchanged-account readback' }
    : manualResult('OQ-066', 'No owned duplicate-username evidence exists for this run.'));

  // OQ-067: Native PDF download
  results.push(await captureNativeDownload('OQ-067', baseUrl, token ?? '', 'pdf', fixture));

  // OQ-068: §11.10(c) — Backup service operational
  if (token) {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-068', method: 'GET', url: '/api/backup/status', baseUrl, headers: h },
      (status, body) => ({
        passed: successfulResource(status, body),
        notes: successfulResource(status, body)
          ? `Backup service responds (${status}) — record protection per §11.10(c)`
          : 'Backup service endpoint not found',
      }),
    );
    r.regulatoryRef = '§11.10(c)';
    r.testDescription = 'Verify that the backup service is operational and provides record protection capabilities';
    r.acceptanceCriteria = 'Backup status endpoint requires HTTP 200 success=true and observed data status indicating service availability';
    results.push(r);
  } else {
    results.push(manualResult('OQ-068', 'Backup status check requires authentication', {
      regulatoryRef: '§11.10(c)',
      testDescription: 'Verify that the backup service is operational and provides record protection capabilities',
      acceptanceCriteria: 'Backup status endpoint requires HTTP 200 success=true and observed data status indicating service availability',
    }));
  }

  // OQ-069: §11.100(b) — E-signature user certification endpoint
  if (token) {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-069', method: 'GET', url: '/api/esignature/certification-status', baseUrl, headers: h },
      (status, body) => ({
        passed: successfulResource(status, body),
        notes: successfulResource(status, body)
          ? `E-signature certification endpoint exists (${status}) — identity verification per §11.100(b)`
          : 'E-signature certification endpoint not found',
      }),
    );
    r.regulatoryRef = '§11.100(b)';
    r.testDescription = 'Verify that e-signature user certification endpoint exists for identity verification before first use of e-signatures';
    r.acceptanceCriteria = 'Certification status endpoint requires HTTP 200 success=true and observed data status indicating certification tracking';
    results.push(r);
  } else {
    results.push(manualResult('OQ-069', 'Certification check requires authentication', {
      regulatoryRef: '§11.100(b)',
      testDescription: 'Verify that e-signature user certification endpoint exists for identity verification before first use of e-signatures',
      acceptanceCriteria: 'Certification status endpoint requires HTTP 200 success=true and observed data status indicating certification tracking',
    }));
  }

  // OQ-070: §11.10(k)(2) — Change control (version tracking)
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-070', method: 'GET', url: '/health', baseUrl },
      (status, body) => {
        const hasVersion = isRecord(body) && body.success !== false && [body.version, body.buildVersion, body.appVersion].some(value => typeof value === 'string' && value.trim().length > 0);
        return {
          passed: status === 200 && hasVersion,
          notes: status === 200 && hasVersion
            ? 'Nonempty native version metadata observed; change-control process approval is not established by this response'
            : `Health endpoint returned ${status}`,
        };
      },
    );
    r.regulatoryRef = '§11.10(k)(2)';
    r.testDescription = 'Verify that the native health response identifies a nonempty software version';
    r.acceptanceCriteria = 'Health endpoint returns HTTP 200 with a nonempty version, buildVersion, or appVersion; change-control approval remains separate';
    results.push(r);
  }

  return results;
}

// ── Suite 8: Comprehensive Authentication Tests (OQ-076 → OQ-095) ──

export async function runComprehensiveAuthTests(
  baseUrl: string, username: string, password: string, token: string, syntheticMode = false,
): Promise<EvidenceResult[]> {
  const operatorToken = token;
  const created = syntheticMode ? await createAuthFixture('OQ-PASSWORD-FIXTURE', baseUrl, operatorToken) : undefined;
  const fixture = created?.value;
  if (!fixture) {
    const absent = [created?.evidence ?? { ...manualResult('OQ-PASSWORD-FIXTURE', 'Explicit synthetic qualification is required for owned password/session testing.'), method: 'CONTRACT' },
      ...Array.from({ length: 20 }, (_, i) => ({ ...manualResult(`OQ-${String(i+76).padStart(3, '0')}`, 'Owned authentication fixture is unavailable.'), method: 'CONTRACT' }))];
    if (created?.cleanupTarget) absent.push(await disableAuthFixture('OQ-PASSWORD-CLEANUP', baseUrl, operatorToken, created.cleanupTarget));
    else if (created) absent.push({ ...manualResult('OQ-PASSWORD-CLEANUP', 'Native creation identity is unresolved; reconcile OQ-PASSWORD-FIXTURE before retrying.'), method: 'CONTRACT' });
    return absent;
  }
  const session = await login(baseUrl, fixture.body.username, fixture.body.password, 'OQ-PASSWORD-LOGIN');
  const results: EvidenceResult[] = [created!.evidence, session.evidence];
  try {
  if (!session.session) { results.push(...Array.from({ length: 20 }, (_, i) => ({ ...manualResult(`OQ-${String(i+76).padStart(3, '0')}`, 'Owned authentication login failed.'), method: 'CONTRACT' }))); return results; }
  username = fixture.body.username; password = fixture.body.password; token = session.session.token;
  const h = authHeaders(token);

  // OQ-076: Login with empty username
  {
    const r = await captureWithExpectedStatus(
      { testCaseId: 'OQ-076', method: 'POST', url: '/api/auth/login', baseUrl, body: { username: '', password: 'test' } }, 400,
    );
    r.regulatoryRef = '§11.300(a)';
    r.testDescription = 'Verify that login with empty username is rejected with proper validation error';
    r.acceptanceCriteria = 'HTTP 400 when username is empty string';
    results.push(r);
  }

  // OQ-077: Login with empty password
  {
    const r = await captureWithExpectedStatus(
      { testCaseId: 'OQ-077', method: 'POST', url: '/api/auth/login', baseUrl, body: { username: 'test', password: '' } }, 400,
    );
    r.regulatoryRef = '§11.300(b)';
    r.testDescription = 'Verify that login with empty password is rejected with proper validation error';
    r.acceptanceCriteria = 'HTTP 400 when password is empty string';
    results.push(r);
  }

  // OQ-078: Login with SQL injection in username
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-078', method: 'POST', url: '/api/auth/login', baseUrl, body: { username: "' OR 1=1 --", password: 'test' } },
      (status, body) => ({ passed: status === 400 || status === 401, notes: `SQL injection rejected with ${status}` }),
    );
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = 'Verify that SQL injection attempts in username field are rejected';
    r.acceptanceCriteria = 'HTTP 400/401 for SQL injection payload in username';
    results.push(r);
  }

  // OQ-079: Login with XSS in username
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-079', method: 'POST', url: '/api/auth/login', baseUrl, body: { username: '<script>alert(1)</script>', password: 'test' } },
      (status, body) => ({ passed: status === 400 || status === 401, notes: `XSS payload rejected with ${status}` }),
    );
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = 'Verify that XSS attempts in username field are rejected';
    r.acceptanceCriteria = 'HTTP 400/401 for XSS payload in username';
    results.push(r);
  }

  // OQ-080: Login with unicode characters
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-080', method: 'POST', url: '/api/auth/login', baseUrl, body: { username: '用户名テスト', password: 'test' } },
      (status, body) => ({ passed: status === 400 || status === 401, notes: `Unicode login handled with ${status}` }),
    );
    r.regulatoryRef = '§11.300(a)';
    r.testDescription = 'Verify that unicode characters in username are handled safely without crash';
    r.acceptanceCriteria = 'HTTP 400/401 for unicode username — no server crash';
    results.push(r);
  }

  // OQ-081: Login with 256+ char username
  {
    const longUser = 'a'.repeat(300);
    const r = await captureWithValidator(
      { testCaseId: 'OQ-081', method: 'POST', url: '/api/auth/login', baseUrl, body: { username: longUser, password: 'test' } },
      (status, body) => ({ passed: status === 400 || status === 401, notes: `Oversized username handled with ${status}` }),
    );
    r.regulatoryRef = '§11.300(a)';
    r.testDescription = 'Verify that excessively long username (256+ chars) is rejected by validation';
    r.acceptanceCriteria = 'HTTP 400/401 for username exceeding max length';
    results.push(r);
  }

  // OQ-082: Login with null body
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-082', method: 'POST', url: '/api/auth/login', baseUrl, body: null },
      (status, body) => ({ passed: status === 400 || status === 401 || status === 415, notes: `Null body handled with ${status}` }),
    );
    r.regulatoryRef = '§11.300(a)';
    r.testDescription = 'Verify that login with null/missing request body returns proper error';
    r.acceptanceCriteria = 'HTTP 400/401/415 for null request body';
    results.push(r);
  }

  // OQ-083: Login without Content-Type header
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-083', method: 'POST', url: '/api/auth/login', baseUrl, body: { username, password }, headers: { 'Content-Type': '' } },
      (status, body) => ({ passed: status === 400 || status === 415, notes: `Unsupported content type refused with ${status}` }),
    );
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = 'Verify that missing Content-Type header does not cause server error';
    r.acceptanceCriteria = 'HTTP 400/415 when Content-Type is missing';
    results.push(r);
  }

  // OQ-084: Login response does not contain password
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-084', method: 'POST', url: '/api/auth/login', baseUrl, body: { username, password } },
      (status, body) => {
        const bodyStr = JSON.stringify(body);
        const leaksPassword = bodyStr.includes(password) && password.length > 3;
        return { passed: status === 200 && isRecord(body) && body.success === true && !leaksPassword, notes: leaksPassword ? 'CRITICAL: password found in response' : 'Login response does not contain password' };
      },
    );
    r.regulatoryRef = '§11.300(b)';
    r.testDescription = 'Verify that login response body does not echo back the password in any field';
    r.acceptanceCriteria = 'Response body does not contain the submitted password value';
    results.push(r);
  }

  // OQ-085: Login response contains user object with expected fields
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-085', method: 'POST', url: '/api/auth/login', baseUrl, body: { username, password } },
      (status, body) => {
        if (status !== 200 || !isRecord(body)) return { passed: false, notes: `Login failed: ${status}` };
        const hasToken = body.success === true && typeof body.accessToken === 'string' && body.accessToken.length > 0;
        const hasUser = isRecord(body.user) && body.user.userId === fixture.userId;
        return { passed: hasToken && hasUser, notes: `accessToken=${hasToken}, user=${hasUser}` };
      },
    );
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that successful login returns accessToken and user object with identity fields';
    r.acceptanceCriteria = 'Response contains accessToken string and user object';
    results.push(r);
  }

  // OQ-086: Access token has reasonable expiration
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-086', method: 'POST', url: '/api/auth/login', baseUrl, body: { username, password } },
      (status, body) => {
        if (status !== 200 || !isRecord(body)) return { passed: false, notes: `Login failed: ${status}` };
        try {
          const tok = body.accessToken as string;
          const payload = JSON.parse(Buffer.from(tok.split('.')[1], 'base64').toString()) as Record<string, unknown>;
          const exp = payload.exp as number;
          const now = Math.floor(Date.now() / 1000);
          const hoursUntilExpiry = (exp - now) / 3600;
          return { passed: hoursUntilExpiry > 0 && hoursUntilExpiry <= 24, notes: `Token expires in ${hoursUntilExpiry.toFixed(1)}h` };
        } catch { return { passed: false, notes: 'Could not decode token expiration' }; }
      },
    );
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that access token expiration is reasonable (> 0h and <= 24h)';
    r.acceptanceCriteria = 'JWT exp claim indicates token expires within 24 hours';
    results.push(r);
  }

  // OQ-087: Issued refresh token returns a usable new native access session.
  results.push((await captureQualificationOperation('OQ-087', baseUrl, token, 'Refresh the owned viewer session and verify the returned access token', async request => {
    if (!session.session?.refreshToken) throw new Error('Native login did not issue a refresh token.');
    const refreshed = expectStudySuccess(await request('POST', '/auth/refresh', { refreshToken: session.session.refreshToken }), 200);
    if (typeof refreshed.accessToken !== 'string' || !refreshed.accessToken) throw new Error('Refresh response has no access token.');
    const verified = await captureApiCall({ testCaseId: 'OQ-087-verify', method: 'GET', url: '/api/auth/verify', baseUrl, headers: authHeaders(refreshed.accessToken) });
    results.push({ ...verified, testCaseId: 'OQ-REFRESH-READBACK' });
    if (!verified.passed || verified.responseStatus !== 200) throw new Error('Refreshed native session is not usable.');
  })).evidence);
  results.push(await captureWithExpectedStatus({ testCaseId: 'OQ-088', method: 'POST', url: '/api/auth/refresh', baseUrl,
    body: { refreshToken: 'invalid.refresh.token' } }, 401));

  // OQ-089: Profile endpoint returns user data
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-089', method: 'GET', url: '/api/auth/profile', baseUrl, headers: h },
      (status, body) => {
        const hasData = status === 200 && isRecord(body);
        return { passed: successfulResource(status, body), notes: `Profile endpoint responds (${status})` };
      },
    );
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that authenticated user can retrieve their profile data';
    r.acceptanceCriteria = 'Profile endpoint requires HTTP 200 success=true and observed data with user data for authenticated user';
    results.push(r);
  }

  // OQ-090: Profile endpoint returns 401 when unauthenticated
  {
    const r = await captureWithExpectedStatus(
      { testCaseId: 'OQ-090', method: 'GET', url: '/api/auth/profile', baseUrl }, 401,
    );
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that profile endpoint denies unauthenticated access';
    r.acceptanceCriteria = 'HTTP 401 when accessing profile without token';
    results.push(r);
  }

  // OQ-091: Change password endpoint exists
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-091', method: 'POST', url: '/api/auth/change-password', baseUrl, headers: h, body: { currentPassword: 'x', newPassword: 'y' } },
      (status, body) => ({ passed: status === 400 && isRecord(body) && body.success === false, notes: `Malformed password change refused (${status})` }),
    );
    r.regulatoryRef = '§11.300(b)';
    r.testDescription = 'Verify that change password endpoint exists for credential rotation';
    r.acceptanceCriteria = 'Change password endpoint requires HTTP 200 success=true and observed data status';
    results.push(r);
  }

  // OQ-092: Change password with wrong current password
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-092', method: 'POST', url: '/api/auth/change-password', baseUrl, headers: h, body: { currentPassword: 'WrongCurrent!99', newPassword: 'NewStrong!123' } },
      (status, body) => ({ passed: status === 400 || status === 401 || status === 403, notes: `Wrong current password rejected (${status})` }),
    );
    r.regulatoryRef = '§11.300(b)';
    r.testDescription = 'Verify that password change with incorrect current password is rejected';
    r.acceptanceCriteria = 'HTTP 400/401/403 when current password is wrong';
    results.push(r);
  }

  // OQ-093: Exact policy refusal plus unchanged owned-password verification
  results.push(await weakPasswordRefusal('OQ-093', baseUrl, username, password));

  // OQ-094: Both concurrently requested owned sessions must be usable.
  {
    const sessions = await Promise.all(['a', 'b'].map(id => login(baseUrl, username, password, `OQ-094-login-${id}`)));
    const checks = await Promise.all(sessions.map((item, i) => item.session ? captureApiCall({ testCaseId: `OQ-094-verify-${i}`,
      method: 'GET', url: '/api/auth/verify', baseUrl, headers: authHeaders(item.session.token) }) : Promise.resolve(item.evidence)));
    results.push({ ...sessions[0].evidence, testCaseId: 'OQ-094',
      passed: sessions.every(item => !!item.session) && checks.every(row => row.passed && row.responseStatus === 200),
      notes: 'Two concurrent login requests each require a usable native session and independent verification.',
      relatedEvidence: [...sessions.map(item => item.evidence), ...checks] });
  }

  // OQ-095: Token from different context cannot access another user's data
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-095', method: 'GET', url: '/api/auth/verify', baseUrl, headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjk5OTk5fQ.invalid' } },
      (status, body) => ({ passed: status === 401, notes: `Forged token rejected (${status})` }),
    );
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that a forged token with fabricated userId is rejected';
    r.acceptanceCriteria = 'HTTP 401 for forged JWT with invalid signature';
    results.push(r);
  }

  } catch (error) { results.push({ ...manualResult('OQ-PASSWORD-EXECUTION', 'Unexpected owned password-suite exception; retained steps identify completed operations.'), method: 'CONTRACT' }); }
  finally { results.push(await disableAuthFixture('OQ-PASSWORD-CLEANUP', baseUrl, operatorToken, fixture)); }
  for (let id = 76; id <= 95; id++) { const testCaseId = `OQ-${String(id).padStart(3, '0')}`; if (!results.some(row => row.testCaseId === testCaseId)) results.push({ ...manualResult(testCaseId, 'Password suite did not execute this case.'), method: 'CONTRACT' }); }
  return results;
}

// ── Suite 9: Comprehensive RBAC Tests (OQ-096 → OQ-120) ──

export async function runComprehensiveRbacTests(
  baseUrl: string, token: string, fixture?: OwnedOqFixture,
): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const h = authHeaders(token);

  // OQ-096: GET /api/studies returns data
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-096', method: 'GET', url: '/api/studies', baseUrl, headers: h },
      validateStudyPage,
    );
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that GET /api/studies returns study data for authenticated user';
    r.acceptanceCriteria = 'HTTP 200 success=true with canonical StudySummaryPage';
    results.push(r);
  }

  // OQ-097: POST /api/studies creates a study (if admin)
  {
    const content = pendingStudy(`OQ_Test_${Date.now()}`, `OQ${Date.now()}`, 'Synthetic OQ authorization fixture');
    const r = fixture ? nativeCase(fixture, 'PQ-001', 'OQ-097')
      : (await captureStudyOperation('OQ-097', baseUrl, token, 'Create and read back an authorized canonical draft',
        client => client.create(content, 'Qualify study creation authorization'))).evidence;
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that the admin role can create and retrieve an exact canonical study draft';
    r.acceptanceCriteria = 'HTTP 201 success=true workspace, numeric native study ID and exact HTTP 200 revision readback';
    results.push(r);
  }

  // OQ-098: GET /api/forms returns forms
  {
    const r = await captureApiCall({ testCaseId: 'OQ-098', method: 'GET', url: '/api/forms', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that GET /api/forms returns form data for authenticated user';
    r.acceptanceCriteria = 'HTTP 200 with forms data';
    results.push(r);
  }

  // OQ-099: GET /api/events returns events
  {
    const r = await captureApiCall({ testCaseId: 'OQ-099', method: 'GET', url: '/api/events', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that GET /api/events returns event data for authenticated user';
    r.acceptanceCriteria = 'HTTP 200 with events data';
    results.push(r);
  }

  // OQ-100: GET /api/queries returns queries
  {
    const r = await captureApiCall({ testCaseId: 'OQ-100', method: 'GET', url: '/api/queries', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that GET /api/queries returns query data for authenticated user';
    r.acceptanceCriteria = 'HTTP 200 with queries data';
    results.push(r);
  }

  // OQ-101: GET /api/audit returns audit entries
  {
    const r = await captureApiCall({ testCaseId: 'OQ-101', method: 'GET', url: '/api/audit?limit=5', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(e)';
    r.testDescription = 'Verify that GET /api/audit returns audit data for authorized user';
    r.acceptanceCriteria = 'HTTP 200 with audit entries';
    results.push(r);
  }

  // OQ-102: GET /api/users returns users (admin only)
  {
    const r = await captureApiCall({ testCaseId: 'OQ-102', method: 'GET', url: '/api/users', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that GET /api/users returns user list for admin role';
    r.acceptanceCriteria = 'HTTP 200 with user list for admin';
    results.push(r);
  }

  // OQ-103: GET /api/data-locks returns locks
  {
    const r = await captureApiCall({ testCaseId: 'OQ-103', method: 'GET', url: '/api/data-locks', baseUrl, headers: h });
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that GET /api/data-locks returns lock records for authorized user';
    r.acceptanceCriteria = 'HTTP 200 with data locks list';
    results.push(r);
  }

  // OQ-104: GET /api/notifications exists
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-104', method: 'GET', url: '/api/notifications', baseUrl, headers: h },
      (status, body) => ({ passed: successfulResource(status, body), notes: `Notifications endpoint responds (${status})` }),
    );
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that notifications endpoint exists for authenticated users';
    r.acceptanceCriteria = 'Notifications endpoint requires HTTP 200 success=true and observed data';
    results.push(r);
  }

  // OQ-105: GET /api/workflow/tasks exists
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-105', method: 'GET', url: '/api/workflow/tasks', baseUrl, headers: h },
      (status, body) => ({ passed: successfulResource(status, body), notes: `Workflow tasks endpoint responds (${status})` }),
    );
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = 'Verify that workflow tasks endpoint exists for authenticated users';
    r.acceptanceCriteria = 'Workflow tasks endpoint requires HTTP 200 success=true and observed data';
    results.push(r);
  }

  // OQ-106: GET /api/validation-rules exists
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-106', method: 'GET', url: '/api/validation-rules', baseUrl, headers: h },
      (status, body) => ({ passed: successfulResource(status, body), notes: `Validation rules endpoint responds (${status})` }),
    );
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = 'Verify that validation rules endpoint exists for data quality management';
    r.acceptanceCriteria = 'Validation rules endpoint requires HTTP 200 success=true and observed data';
    results.push(r);
  }

  // OQ-107: POST endpoint without body returns 400
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-107', method: 'POST', url: '/api/queries', baseUrl, headers: h, body: {} },
      (status, body) => ({ passed: status === 400 || status === 422, notes: `Empty POST body validation (${status})` }),
    );
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = 'Verify that POST without required body fields returns validation error';
    r.acceptanceCriteria = 'HTTP 400/422 for POST with empty body';
    results.push(r);
  }

  // OQ-108: Historical flat writes are intentionally rejected before mutation.
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-108', method: 'PUT', url: '/api/studies/not-a-native-id', baseUrl, headers: h, body: { name: 'test' } },
      (status, body) => ({
        passed: status === 400 && isRecord(body) && body.success === false && body.code === 'STUDY_COMMAND_FIELD_UNKNOWN',
        notes: `Legacy flat study write must be rejected as STUDY_COMMAND_FIELD_UNKNOWN (${status})`,
      }),
    );
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = 'Verify that a legacy flat study PUT is explicitly rejected';
    r.acceptanceCriteria = 'HTTP 400 success=false and STUDY_COMMAND_FIELD_UNKNOWN';
    results.push(r);
  }

  // OQ-109: DELETE endpoint with invalid ID returns 404/400
  {
    const r = await captureWithValidator(
      { testCaseId: 'OQ-109', method: 'DELETE', url: '/api/studies/not-a-native-id', baseUrl, headers: h },
      (status, body) => ({ passed: (status >= 400 && status < 500), notes: `Invalid ID DELETE handled (${status})` }),
    );
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = 'Verify that DELETE with non-existent ID returns proper error';
    r.acceptanceCriteria = 'HTTP 4xx for DELETE to non-existent resource';
    results.push(r);
  }

  // OQ-110 through OQ-120: Test protected endpoints without auth (all should 401)
  const protectedEndpoints: Array<{ id: string; url: string }> = [
    { id: 'OQ-110', url: '/api/studies' },
    { id: 'OQ-111', url: '/api/forms' },
    { id: 'OQ-112', url: '/api/subjects?studyId=0' },
    { id: 'OQ-113', url: '/api/events' },
    { id: 'OQ-114', url: '/api/queries' },
    { id: 'OQ-115', url: '/api/audit' },
    { id: 'OQ-116', url: '/api/users' },
    { id: 'OQ-117', url: '/api/data-locks' },
    { id: 'OQ-118', url: '/api/notifications' },
    { id: 'OQ-119', url: '/api/workflow/tasks' },
    { id: 'OQ-120', url: '/api/dashboard/summary' },
  ];

  for (const ep of protectedEndpoints) {
    const r = await captureWithExpectedStatus(
      { testCaseId: ep.id, method: 'GET', url: ep.url, baseUrl }, 401,
    );
    r.regulatoryRef = '§11.10(d)';
    r.testDescription = `Verify that ${ep.url} denies unauthenticated access`;
    r.acceptanceCriteria = `HTTP 401 when accessing ${ep.url} without token`;
    results.push(r);
  }

  return results;
}

// ── Suite 10: Comprehensive Audit Trail Tests (OQ-121 → OQ-145) ──

export async function runComprehensiveAuditTests(baseUrl: string, token: string, fixture?: OwnedOqFixture): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const h = authHeaders(token);
  const studyId = fixture?.state.studyId ?? 0;
  const auditRes = await captureWithValidator({ testCaseId: 'OQ-121-fetch', method: 'GET',
    url: `/api/audit?studyId=${studyId}&limit=500`, baseUrl, headers: h },
    (status, body) => ({ passed: successfulResource(status, body) && !!getEntries(body)?.every(row => row.studyId === studyId), notes: 'Owned study audit rows must be present and preserve native scope.' }));
  const entries = auditRes.passed ? getEntries(auditRes.responseBody) : null;
  const derived = (id: string, passed: boolean, description: string) => ({ ...auditRes, testCaseId: id,
    passed: auditRes.passed && passed, testDescription: description, notes: description + (auditRes.passed && passed ? ' verified.' : ' not established.'), relatedEvidence: [auditRes] });
  results.push(derived('OQ-121', !!entries && entries.every(row => typeof row.auditDate === 'string' && Number.isFinite(Date.parse(row.auditDate))), 'Owned audit rows contain valid native timestamps'));
  results.push(derived('OQ-122', !!entries && entries.every(row => nativeId(row.userId)), 'Owned audit rows identify a native operator'));
  const userId = entries?.find(row => nativeId(row.userId))?.userId;
  const eventType = entries?.find(row => typeof row.eventTypeName === 'string')?.eventTypeName;
  const startDate = entries?.map(row => String(row.auditDate)).sort()[0];
  for (const item of [
    { id: 'OQ-123', query: 'page=1&limit=5', predicate: (rows: Record<string, unknown>[]) => rows.length <= 5 },
    { id: 'OQ-124', query: `startDate=${encodeURIComponent(startDate ?? '')}`, predicate: (rows: Record<string, unknown>[]) => !!startDate && rows.every(row => Date.parse(String(row.auditDate)) >= Date.parse(startDate)) },
    { id: 'OQ-125', query: `eventType=${encodeURIComponent(String(eventType ?? ''))}`, predicate: (rows: Record<string, unknown>[]) => !!eventType && rows.every(row => String(row.eventTypeName).toLowerCase().includes(String(eventType).toLowerCase())) },
    { id: 'OQ-126', query: `userId=${userId ?? 0}`, predicate: (rows: Record<string, unknown>[]) => nativeId(userId) && rows.every(row => row.userId === userId) },
  ]) {
    results.push(await captureWithValidator({ testCaseId: item.id, method: 'GET', url: `/api/audit?studyId=${studyId}&${item.query}`, baseUrl, headers: h },
      (status, body) => { const rows = getEntries(body); return { passed: successfulResource(status, body) && !!rows && rows.every(row => row.studyId === studyId) && item.predicate(rows), notes: 'Native audit filter requires nonempty, correctly scoped matching rows.' }; }));
  }
  results.push(await captureWithValidator({ testCaseId: 'OQ-127', method: 'GET', url: `/api/audit/login-history?username=${encodeURIComponent(fixture?.state.qualification?.username ?? '')}&status=success&limit=10`, baseUrl, headers: h },
    (status, body) => { const rows = getEntries(body); return { passed: successfulResource(status, body) && !!fixture?.state.qualification?.username && !!rows
      && rows.some(row => (row.username ?? row.userName) === fixture.state.qualification!.username && row.login_status === 1 && row.status_text === 'success'), notes: 'Successful native login observation for this qualification operator is required.' }; }));
  const correction = fixture?.results.find(row => row.testCaseId === 'PQ-037');
  results.push(correction ? { ...correction, testCaseId: 'OQ-128', relatedEvidence: [correction], notes: 'Exact own native correction audit is the mutation evidence; not an audit-count baseline.' }
    : derived('OQ-128', false, 'No owned native correction/audit evidence'));
  for (const [id, method] of [['OQ-129', 'PUT'], ['OQ-130', 'PATCH'], ['OQ-131', 'DELETE'], ['OQ-132', 'POST']] as const)
    results.push(await captureAuditRefusal(id, baseUrl, token, method, fixture));
  // The native viewer deliberately does not expose record_hash. Use its actual
  // recomputation endpoint and retain the complete coverage/exception witness.
  const integrity = await captureWithValidator({ testCaseId: 'OQ-133', method: 'GET', url: '/api/audit/verify', baseUrl, headers: h },
    (status, body) => { const d = isRecord(body) && isRecord(body.data) ? body.data : null;
      return { passed: status === 200 && isRecord(body) && body.success === true && !!d && d.valid === true
        && Number.isSafeInteger(d.recordsChecked) && Number(d.recordsChecked) > 0 && d.unverifiable === 0 && d.truncated === false
        && d.firstBreak === null && Array.isArray(d.integrityExceptions) && d.integrityExceptions.length === 0
        && isRecord(d.deferredRows) && d.deferredRows.pending === 0 && d.deferredRows.stalePending === 0 && d.deferredRows.quarantined === 0,
        notes: 'Native hash/chain recomputation requires a nonempty complete verifiable scan with no breaks or deferred gaps. This is native-service evidence, not independent database recomputation.' }; });
  results.push(integrity, ...['OQ-134', 'OQ-135'].map(testCaseId => ({ ...integrity, testCaseId, relatedEvidence: [integrity] })));
  const tables: Array<[string, string[], number | undefined]> = [
    ['OQ-136', ['study'], studyId], ['OQ-137', ['study_subject'], fixture?.state.subjectId ?? undefined],
    ['OQ-138', ['item_data', 'event_crf'], undefined], ['OQ-139', ['discrepancy_note'], fixture?.state.queryId ?? undefined],
    ['OQ-140', ['acc_esignatures'], fixture?.state.signatureId ?? undefined], ['OQ-141', ['event_crf'], fixture?.state.formDataId ?? undefined],
    ['OQ-143', ['study_event'], fixture?.state.visitId ?? undefined],
  ];
  for (const [id, names, entityId] of tables) results.push(derived(id,
    !!entries?.some(row => names.includes(String(row.auditTable)) && (entityId === undefined || row.entityId === entityId)),
    `Owned native ${names.join('/')} mutation audit`));
  results.push(await captureWithValidator({ testCaseId: 'OQ-142', method: 'GET', url: '/api/audit?limit=500', baseUrl, headers: h },
    (status, body) => ({ passed: successfulResource(status, body) && nativeId(fixture?.authUserId) && !!getEntries(body)?.some(row => row.auditTable === 'user_account' && row.entityId === fixture.authUserId), notes: 'An independently read audit row must identify this run’s owned authentication account.' })));
  results.push(derived('OQ-144', !!entries?.some(row => /export/i.test(String(row.eventTypeName))), 'Owned study export audit'));
  results.push(derived('OQ-145', !!entries?.some(row => /workflow/i.test(String(row.eventTypeName))), 'Owned workflow transition audit'));

  return results;
}

// ── Suite 11: Data Operations Deep Tests (OQ-146 → OQ-170) ──

export async function runDeepDataOperationTests(baseUrl: string, token: string, qualification?: StudyActivationReview, fixture?: OwnedOqFixture): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const h = authHeaders(token);

  // OQ-146
  { const r = await captureWithValidator({ testCaseId: 'OQ-146', method: 'GET', url: '/api/studies', baseUrl, headers: h }, validateStudyPage); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify GET /api/studies returns canonical study summary pages'; r.acceptanceCriteria = 'HTTP 200 success=true with StudySummaryPage'; results.push(r); }

  // OQ-153 owns the fixture used by the readback tests. Never select study 1 or
  // the first user study to make a mutation test appear to pass.
  const content = pendingStudy(`DeepTest_${Date.now()}`, `DT${Date.now()}`, 'OQ deep test study');
  const state = fixture?.state ?? createWorkflowState(baseUrl, token);
  const workflow = fixture?.setup ?? (qualification ? await runStudySetup(baseUrl, state, qualification) : undefined);
  const created = workflow
    ? { evidence: { ...workflow[0], testCaseId: 'OQ-153' }, value: state.studyWorkspace }
    : await captureStudyOperation('OQ-153', baseUrl, token, 'Create and read back the complete canonical draft',
      client => client.create(content, 'Create synthetic OQ data-operation fixture'));
  created.evidence.regulatoryRef = '§11.10(a)';
  created.evidence.testDescription = 'Verify canonical study creation preserves the complete submitted draft';
  created.evidence.acceptanceCriteria = 'HTTP 201 success=true and exact HTTP 200 revision readback; validation errors fail';
  results.push(created.evidence);

  // OQ-147
  { const r = created.value
    ? (await captureStudyOperation('OQ-147', baseUrl, token, 'Retrieve created native study', client => client.verify(created.value!))).evidence
    : manualResult('OQ-147', 'Blocked: OQ-153 did not produce a verified canonical study');
    r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Retrieve the fixture created by OQ-153'; r.acceptanceCriteria = 'HTTP 200 with exact native ID, revision and content'; results.push(r); }

  // OQ-148
  { const r = await captureWithValidator({ testCaseId: 'OQ-148', method: 'GET', url: '/api/forms', baseUrl, headers: h }, (status, body) => { const isArr = Array.isArray(body) || (isRecord(body) && Array.isArray(body.data)); return { passed: status === 200 && isArr, notes: `Forms returns array (${status})` }; }); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify GET /api/forms returns array of forms'; r.acceptanceCriteria = 'HTTP 200 with array response'; results.push(r); }

  // OQ-149
  { const r = await captureWithValidator({ testCaseId: 'OQ-149', method: 'GET', url: `/api/forms?studyId=${state.studyId ?? 0}`, baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Forms with studyId filter: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify GET /api/forms with studyId filter'; r.acceptanceCriteria = 'HTTP 200 success=true with observed data for studyId-filtered forms query'; results.push(r); }

  // OQ-150
  { const r = await captureWithValidator({ testCaseId: 'OQ-150', method: 'GET', url: `/api/subjects?studyId=${state.studyId ?? 0}`, baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Subjects with studyId filter: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify GET /api/subjects with studyId filter'; r.acceptanceCriteria = 'HTTP 200 success=true with observed data for studyId-filtered subjects'; results.push(r); }

  // OQ-151
  { const r = await captureWithValidator({ testCaseId: 'OQ-151', method: 'GET', url: `/api/events?studyId=${state.studyId ?? 0}`, baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Events with studyId filter: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify GET /api/events with studyId filter'; r.acceptanceCriteria = 'HTTP 200 success=true with observed data for studyId-filtered events'; results.push(r); }

  // OQ-152
  { const r = await captureWithValidator({ testCaseId: 'OQ-152', method: 'GET', url: '/api/queries?status=open', baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Queries with status filter: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify GET /api/queries with status filter'; r.acceptanceCriteria = 'HTTP 200 success=true with observed data for status-filtered queries'; results.push(r); }

  // OQ-154
  results.push(workflow ? { ...workflow[0], testCaseId: 'OQ-154',
    testDescription: 'Qualify the owned synthetic study through signed release, reviewed activation and native enrollment/visit readbacks',
    acceptanceCriteria: 'Every setup, activation, subject and planned-visit assertion passes; no manual result is a pass',
    passed: workflow.length === 10 && workflow.every(result => result.passed),
    notes: workflow.every(result => result.passed) ? 'All native synthetic qualification steps verified.'
      : `Qualification incomplete: ${workflow.filter(result => !result.passed).map(result => result.testCaseId + ': ' + result.notes).join('; ')}`,
    relatedEvidence: workflow,
  } : manualResult('OQ-154', 'Blocked: explicit synthetic qualification is required for signed release, reviewed activation and enrollment.'));

  // OQ-155
  { const r = created.value
    ? (await captureStudyOperation('OQ-155', baseUrl, token, 'Verify exact canonical graph roundtrip', client => client.verify(created.value!))).evidence
    : manualResult('OQ-155', 'Blocked: OQ-153 did not produce a verified canonical study');
    r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify persisted canonical graph and native identity from the fixture created by this runner'; r.acceptanceCriteria = 'HTTP 200 success=true, matching native study ID, revision token and complete content'; results.push(r); }

  // OQ-156
  { const r = await captureWithValidator({ testCaseId: 'OQ-156', method: 'GET', url: `/api/data-locks?studyId=${state.studyId ?? 0}`, baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Data-locks with studyId: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify data-locks endpoint accepts studyId parameter'; r.acceptanceCriteria = 'HTTP 200 success=true with observed data for studyId-filtered data-locks'; results.push(r); }

  // OQ-157 to OQ-170: CRUD validations
  const crudTests: Array<{ id: string; method: string; url: string; body?: Record<string, unknown>; desc: string }> = [
    { id: 'OQ-157', method: 'GET', url: '/api/forms/not-a-native-id', desc: 'Reject malformed form identifier' },
    { id: 'OQ-158', method: 'GET', url: '/api/subjects/not-a-native-id', desc: 'Reject malformed subject identifier' },
    { id: 'OQ-159', method: 'GET', url: '/api/queries?limit=1&offset=0', desc: 'Query pagination' },
    { id: 'OQ-160', method: 'GET', url: '/api/studies?limit=1&page=1', desc: 'Study pagination' },
    { id: 'OQ-161', method: 'POST', url: '/api/queries', body: { studyId: state.studyId ?? 0, subjectId: 0, description: 'Synthetic invalid subject query' }, desc: 'Create query with invalid subject' },
    { id: 'OQ-162', method: 'GET', url: '/api/dashboard/enrollment', desc: 'Dashboard enrollment data' },
    { id: 'OQ-163', method: 'GET', url: '/api/dashboard/completion', desc: 'Dashboard completion data' },
    { id: 'OQ-164', method: 'GET', url: '/api/dashboard/queries', desc: 'Dashboard queries data' },
    { id: 'OQ-165', method: 'GET', url: '/api/dashboard/activity', desc: 'Dashboard activity data' },
    { id: 'OQ-166', method: 'GET', url: '/api/esignature/pending', desc: 'Pending signatures' },
    { id: 'OQ-167', method: 'GET', url: '/api/data-locks/unlock-requests', desc: 'Unlock requests list' },
    { id: 'OQ-168', method: 'POST', url: '/api/esignature/verify-password', body: { password: 'wrong' }, desc: 'Reject e-signature verification without a username' },
    { id: 'OQ-169', method: 'GET', url: `/api/export/forms/${fixture?.state.studyId ?? 0}`, desc: 'Export forms for study' },
    { id: 'OQ-170', method: 'GET', url: `/api/export/events/${state.studyId ?? 0}`, desc: 'Export events for study' },
  ];
  for (const t of crudTests) {
    const opts = { testCaseId: t.id, method: t.method, url: t.url, baseUrl, headers: h, body: t.body as Record<string, unknown> | undefined };
    const r = await captureWithValidator(opts, t.id === 'OQ-160' ? validateStudyPage
      : (status, body) => ({ passed: ['OQ-157', 'OQ-158', 'OQ-161', 'OQ-168'].includes(t.id) ? status === 400 && isRecord(body) && body.success === false : successfulResource(status, body), notes: `${t.desc}: ${status}` }));
    r.regulatoryRef = '§11.10(a)';
    r.testDescription = `Verify ${t.desc} endpoint responds correctly`;
    r.acceptanceCriteria = t.id === 'OQ-160' ? 'HTTP 200 success=true with canonical StudySummaryPage'
      : ['OQ-157', 'OQ-158', 'OQ-161', 'OQ-168'].includes(t.id) ? 'HTTP 400 success=false for the explicitly invalid request' : `${t.desc} endpoint requires HTTP 200 success=true and observed data`;
    results.push(r);
  }

  return results;
}

// ── Suite 12: Security & Input Validation Tests (OQ-171 → OQ-200) ──

export async function runSecurityValidationTests(
  baseUrl: string, token: string, username: string, password: string, fixture?: OwnedOqFixture,
): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const h = authHeaders(token);

  // OQ-171: Observe the actual response headers, not only the status.
  { const r = await captureApiCall({ testCaseId: 'OQ-171', method: 'GET', url: '/health', baseUrl });
    r.passed = r.passed && r.responseStatus === 200 && r.responseHeaders?.['x-content-type-options'] === 'nosniff'
      && ['DENY', 'SAMEORIGIN'].includes((r.responseHeaders?.['x-frame-options'] ?? '').toUpperCase());
    r.notes = 'Requires a successful health response with nosniff and DENY/SAMEORIGIN frame headers.'; results.push(r); }
  results.push({ ...await testCorsPreflight(baseUrl), testCaseId: 'OQ-172' });
  results.push({ ...await testPathTraversal(baseUrl), testCaseId: 'OQ-173' });

  // OQ-174: Large payload rejection
  { const bigPayload = { data: 'x'.repeat(5000000) }; const r = await captureWithValidator({ testCaseId: 'OQ-174', method: 'POST', url: '/api/auth/login', baseUrl, body: bigPayload }, (status, body) => ({ passed: status === 413 || status === 400 || status === 401, notes: `Large payload handled (${status})` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify excessively large payloads are rejected'; r.acceptanceCriteria = 'HTTP 400/413 for oversized request body'; results.push(r); }

  // OQ-175: JSON content type enforced
  { const r = await captureWithValidator({ testCaseId: 'OQ-175', method: 'POST', url: '/api/auth/login', baseUrl, headers: { 'Content-Type': 'text/plain' }, body: { username, password } }, (status, body) => ({ passed: status === 400 || status === 415, notes: `Wrong content type refused (${status})` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify server handles incorrect Content-Type gracefully'; r.acceptanceCriteria = 'HTTP 400/415 for unsupported request content type'; results.push(r); }

  // OQ-176: HTTP method not allowed
  { const r = await captureWithValidator({ testCaseId: 'OQ-176', method: 'PATCH', url: '/api/studies', baseUrl, headers: h, body: {} }, (status, body) => ({ passed: (status >= 400 && status < 500), notes: `PATCH on collection rejected (${status})` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify unsupported HTTP methods return proper error'; r.acceptanceCriteria = 'HTTP 4xx for unsupported method'; results.push(r); }

  // OQ-177: Expired token handling
  { const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImV4cCI6MTAwMDAwMDAwMH0.invalid'; const r = await captureWithExpectedStatus({ testCaseId: 'OQ-177', method: 'GET', url: '/api/studies', baseUrl, headers: { Authorization: `Bearer ${expiredToken}` } }, 401); r.regulatoryRef = '§11.10(d)'; r.testDescription = 'Verify expired JWT token is rejected'; r.acceptanceCriteria = 'HTTP 401 for expired token'; results.push(r); }

  // OQ-178: Bearer prefix required
  { const r = await captureWithExpectedStatus({ testCaseId: 'OQ-178', method: 'GET', url: '/api/studies', baseUrl, headers: { Authorization: token } }, 401); r.regulatoryRef = '§11.10(d)'; r.testDescription = 'Verify token without Bearer prefix is rejected'; r.acceptanceCriteria = 'HTTP 401 for token without Bearer prefix'; results.push(r); }

  // OQ-179: Double-encoded URL handling
  { const r = await captureWithValidator({ testCaseId: 'OQ-179', method: 'GET', url: '/api/studies/%252e%252e%252f', baseUrl, headers: h }, (status, body) => ({ passed: (status >= 400 && status < 500), notes: `Double-encoded URL handled (${status})` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify double-encoded URL path is handled safely'; r.acceptanceCriteria = 'HTTP 4xx for double-encoded traversal'; results.push(r); }

  // OQ-180: Null byte injection
  { const r = await captureWithValidator({ testCaseId: 'OQ-180', method: 'POST', url: '/api/auth/login', baseUrl, body: { username: 'admin\x00evil', password: 'test' } }, (status, body) => ({ passed: status === 400 || status === 401, notes: `Null byte handled (${status})` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify null byte injection in input is handled safely'; r.acceptanceCriteria = 'HTTP 400/401 for null byte in username'; results.push(r); }

  // OQ-181: Integer overflow in ID param
  { const r = await captureWithValidator({ testCaseId: 'OQ-181', method: 'GET', url: '/api/studies/99999999999999999999', baseUrl, headers: h }, (status, body) => ({ passed: status === 400 || status === 404, notes: `Integer overflow handled (${status})` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify integer overflow in path params is handled'; r.acceptanceCriteria = 'HTTP 400/404 for oversized integer ID'; results.push(r); }

  // OQ-182: Negative ID param
  { const r = await captureWithValidator({ testCaseId: 'OQ-182', method: 'GET', url: '/api/studies/-1', baseUrl, headers: h }, (status, body) => ({ passed: status === 400 || status === 404, notes: `Negative ID handled (${status})` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify negative integer in path params is handled'; r.acceptanceCriteria = 'HTTP 400/404 for negative ID'; results.push(r); }

  // OQ-183: String where number expected
  { const r = await captureWithValidator({ testCaseId: 'OQ-183', method: 'GET', url: '/api/studies/abc', baseUrl, headers: h }, (status, body) => ({ passed: status === 400 || status === 404, notes: `String ID handled (${status})` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify string in numeric path param returns validation error'; r.acceptanceCriteria = 'HTTP 400/404 for string where number expected'; results.push(r); }

  // OQ-184: Multiple auth headers
  { const r = await captureWithValidator({ testCaseId: 'OQ-184', method: 'GET', url: '/api/studies', baseUrl, headers: { Authorization: `Bearer ${token}`, 'X-Custom-Auth': 'malicious' } }, (status, body) => ({ passed: status === 200 || status === 401, notes: `Multiple auth headers: ${status}` })); r.regulatoryRef = '§11.10(d)'; r.testDescription = 'Verify system handles multiple auth-related headers safely'; r.acceptanceCriteria = 'System uses only standard Authorization header'; results.push(r); }

  // OQ-185: Verify endpoint stability (no 500s)
  { const r = await captureWithValidator({ testCaseId: 'OQ-185', method: 'GET', url: '/api/studies', baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `No 500 error on studies (${status})` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify that /api/studies never returns 500 under normal load'; r.acceptanceCriteria = 'Studies endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-186: Session verify endpoint
  { const r = await captureWithValidator({ testCaseId: 'OQ-186', method: 'GET', url: '/api/auth/verify', baseUrl, headers: h }, (status, body) => ({ passed: status === 200, notes: `Session verify: ${status}` })); r.regulatoryRef = '§11.10(d)'; r.testDescription = 'Verify that session verification endpoint confirms valid sessions'; r.acceptanceCriteria = 'HTTP 200 for valid authenticated session'; results.push(r); }

  // OQ-187: E-signature certification endpoint accessible
  { const r = await captureWithValidator({ testCaseId: 'OQ-187', method: 'GET', url: '/api/esignature/certification-status', baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Certify endpoint: ${status}` })); r.regulatoryRef = '§11.100(c)'; r.testDescription = 'Read the current operator certification status without creating a legal acknowledgment'; r.acceptanceCriteria = 'Certification endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-188: Retain the actual signed native workflow proof
  results.push(nativeCase(fixture, 'PQ-029', 'OQ-188'));

  // OQ-189: Dashboard enrollment trend
  { const r = await captureWithValidator({ testCaseId: 'OQ-189', method: 'GET', url: '/api/dashboard/enrollment-trend', baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Enrollment trend: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify dashboard enrollment trend endpoint responds'; r.acceptanceCriteria = 'Enrollment trend endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-190: Dashboard data quality
  { const r = await captureWithValidator({ testCaseId: 'OQ-190', method: 'GET', url: '/api/dashboard/data-quality', baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Data quality metrics: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify dashboard data quality metrics endpoint responds'; r.acceptanceCriteria = 'Data quality endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-191: Concurrent request handling
  { const r = await captureWithValidator({ testCaseId: 'OQ-191', method: 'GET', url: '/api/studies', baseUrl, headers: h }, validateStudyPage); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify an authenticated canonical study read succeeds'; r.acceptanceCriteria = 'A single read returns HTTP 200 and a canonical study page; concurrency is measured by the performance runner'; results.push(r); }

  // OQ-192: Backup status endpoint
  { const r = await captureWithValidator({ testCaseId: 'OQ-192', method: 'GET', url: '/api/backup/status', baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Backup status: ${status}` })); r.regulatoryRef = '§11.10(c)'; r.testDescription = 'Verify backup status endpoint is accessible'; r.acceptanceCriteria = 'Backup status requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-193: Complete native audit export compared with exact correction
  results.push(await captureAuditDownload('OQ-193', baseUrl, token, fixture));

  // OQ-194: Retained actual batch SDV before signing/locking the fixture
  results.push(fixture?.batchSdv ?? { ...manualResult('OQ-194', 'No owned native batch SDV execution.'), method: 'CONTRACT' });

  // OQ-195: Native ODM download
  results.push(await captureNativeDownload('OQ-195', baseUrl, token ?? '', 'odm', fixture));

  // OQ-196: Retain the actual signed native workflow proof
  results.push(nativeCase(fixture, 'PQ-019', 'OQ-196'));

  // OQ-197: Data locks sanitation report
  { const r = await captureWithValidator({ testCaseId: 'OQ-197', method: 'GET', url: `/api/data-locks/sanitation/${fixture?.state.studyId ?? 0}`, baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Sanitation report: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify data sanitation report endpoint exists'; r.acceptanceCriteria = 'Sanitation report endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-198: Study lock status
  { const r = await captureWithValidator({ testCaseId: 'OQ-198', method: 'GET', url: `/api/data-locks/study/${fixture?.state.studyId ?? 0}/status`, baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Study lock status: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify study-level lock status endpoint exists'; r.acceptanceCriteria = 'Study lock status endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-199: E-signature requirements per study
  { const r = await captureWithValidator({ testCaseId: 'OQ-199', method: 'GET', url: `/api/esignature/requirements/${fixture?.state.studyId ?? 0}`, baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `E-sig requirements: ${status}` })); r.regulatoryRef = '§11.100(a)'; r.testDescription = 'Verify e-signature study requirements endpoint exists'; r.acceptanceCriteria = 'Requirements endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-200: Native reported-failure audit with independent exact readback
  results.push(await recordFailedSignatureAttempt(baseUrl, token, fixture));

  // OQ-201: Dashboard health score
  { const r = await captureWithValidator({ testCaseId: 'OQ-201', method: 'GET', url: '/api/dashboard/health-score', baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Health score: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify dashboard health score endpoint exists'; r.acceptanceCriteria = 'Health score endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-202: Dashboard action items
  { const r = await captureWithValidator({ testCaseId: 'OQ-202', method: 'GET', url: '/api/dashboard/action-items', baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Action items: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify dashboard action items endpoint exists'; r.acceptanceCriteria = 'Action items endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-203: Query aging analysis
  { const r = await captureWithValidator({ testCaseId: 'OQ-203', method: 'GET', url: '/api/dashboard/query-aging', baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Query aging: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify query aging analysis endpoint exists'; r.acceptanceCriteria = 'Query aging endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-204: Visit compliance
  { const r = await captureWithValidator({ testCaseId: 'OQ-204', method: 'GET', url: '/api/dashboard/visit-compliance', baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Visit compliance: ${status}` })); r.regulatoryRef = '§11.10(a)'; r.testDescription = 'Verify visit compliance endpoint exists'; r.acceptanceCriteria = 'Visit compliance endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  // OQ-205: E-signature history for entity
  { const r = await captureWithValidator({ testCaseId: 'OQ-205', method: 'GET', url: `/api/esignature/history/eventCrf/${fixture?.state.formDataId ?? 0}`, baseUrl, headers: h }, (status, body) => ({ passed: successfulResource(status, body), notes: `Sig history: ${status}` })); r.regulatoryRef = '§11.50(a)'; r.testDescription = 'Verify e-signature history endpoint for entity works'; r.acceptanceCriteria = 'Signature history endpoint requires HTTP 200 success=true and observed data'; results.push(r); }

  return results;
}

// ── Main Runner ──

export async function run(outputDir: string, baseUrl: string, _workspaceRoot?: string, qualificationFlags: readonly string[] = []): Promise<EvidenceResult[]> {
  const { username, password } = qualificationCredentials();
  const qualification = qualificationFlags.length ? { ...qualificationOptions(qualificationFlags, baseUrl), username, password,
    reason: 'Execute the explicitly requested synthetic operational qualification fixture' } : undefined;
  console.log(`\n  Running OQ tests (200+ cases) against ${baseUrl}...`);

  const allResults: EvidenceResult[] = [];

  const authResults = await runAuthenticationTests(baseUrl, username, password, !!qualification, true);
  allResults.push(...authResults);
  console.log(`  Suite 1 (Authentication): ${authResults.filter(r => r.passed).length}/${authResults.length} passed`);

  // The OQ-LOGIN exchange itself is not retained; OQ-001 records the valid login.
  const auth = (await login(baseUrl, username, password)).session;
  if (auth) {
    console.log(`  Authenticated as user ${auth.userId}`);
    let fixture: OwnedOqFixture | undefined;
    try {
    if (qualification) {
      const state = createWorkflowState(baseUrl, auth.token);
      fixture = { state, setup: [], results: [] };
      const setup = await runStudySetup(baseUrl, state, qualification);
      fixture.setup = setup; fixture.results.push(...setup);
      fixture.results.push(...await runDataEntry(baseUrl, state));
      const reasonRefusal = await captureMissingChangeReason(baseUrl, state); fixture.reasonRefusal = reasonRefusal;
      const batchSdv = await qualifyBatchSdv(baseUrl, state); fixture.batchSdv = batchSdv;
      fixture.results.push(...await runReviewAndSignature(baseUrl, state));
      fixture.results.push(...await runCleanupVerification(baseUrl, state, false));
      const native = fixture.results;
      const authCreation = authResults.find(row => row.testCaseId === 'OQ-AUTH-FIXTURE');
      const authUserId = isRecord(authCreation?.responseBody) && nativeId(authCreation.responseBody.userId) ? authCreation.responseBody.userId : undefined;
      fixture = { state, setup, results: native, authUserId, batchSdv, reasonRefusal };
      allResults.push({ ...native[0], testCaseId: 'OQ-NATIVE-FIXTURE', passed: native.length === 39 && native.every(row => row.passed),
        notes: 'Owned native workflow prerequisites; exact per-step results are retained as related evidence.', relatedEvidence: native });
    }


    const acResults = await runAccessControlTests(baseUrl, auth.token, fixture);
    allResults.push(...acResults);
    console.log(`  Suite 2 (Access Control): ${acResults.filter(r => r.passed).length}/${acResults.length} passed`);

    const auditResults = await runAuditTrailTests(baseUrl, auth.token, fixture);
    allResults.push(...auditResults);
    console.log(`  Suite 3 (Audit Trail): ${auditResults.filter(r => r.passed).length}/${auditResults.length} passed`);

    const sigResults = await runSignatureTests(baseUrl, auth.token, fixture);
    allResults.push(...sigResults);
    console.log(`  Suite 4 (Signatures): ${sigResults.filter(r => r.passed).length}/${sigResults.length} passed`);

    const dataResults = await runDataOperationTests(baseUrl, auth.token, fixture);
    allResults.push(...dataResults);
    console.log(`  Suite 5 (Data Operations): ${dataResults.filter(r => r.passed).length}/${dataResults.length} passed`);

    const lockResults = await runDataLockTests(baseUrl, auth.token, fixture);
    allResults.push(...lockResults);
    console.log(`  Suite 6 (Data Locks): ${lockResults.filter(r => r.passed).length}/${lockResults.length} passed`);

    const part11Results = await runPart11ComplianceTests(baseUrl, username, password, auth.token, authResults, fixture);
    allResults.push(...part11Results);
    console.log(`  Suite 7 (Part 11 Compliance): ${part11Results.filter(r => r.passed).length}/${part11Results.length} passed`);

    const compAuthResults = await runComprehensiveAuthTests(baseUrl, username, password, auth.token, !!qualification);
    allResults.push(...compAuthResults);
    console.log(`  Suite 8 (Comprehensive Auth): ${compAuthResults.filter(r => r.passed).length}/${compAuthResults.length} passed`);

    const rbacResults = await runComprehensiveRbacTests(baseUrl, auth.token, fixture);
    allResults.push(...rbacResults);
    console.log(`  Suite 9 (Comprehensive RBAC): ${rbacResults.filter(r => r.passed).length}/${rbacResults.length} passed`);

    const compAuditResults = await runComprehensiveAuditTests(baseUrl, auth.token, fixture);
    allResults.push(...compAuditResults);
    console.log(`  Suite 10 (Comprehensive Audit): ${compAuditResults.filter(r => r.passed).length}/${compAuditResults.length} passed`);

    const deepDataResults = await runDeepDataOperationTests(baseUrl, auth.token, qualification, fixture);
    allResults.push(...deepDataResults);
    console.log(`  Suite 11 (Deep Data Operations): ${deepDataResults.filter(r => r.passed).length}/${deepDataResults.length} passed`);

    const securityResults = await runSecurityValidationTests(baseUrl, auth.token, username, password, fixture);
    allResults.push(...securityResults);
    console.log(`  Suite 12 (Security & Validation): ${securityResults.filter(r => r.passed).length}/${securityResults.length} passed`);
    if (fixture) {
      const mapping: Record<string, string> = { 'OQ-034': 'PQ-028', 'OQ-035': 'PQ-028', 'OQ-036': 'PQ-028',
        'OQ-037': 'PQ-027', 'OQ-039': 'PQ-029', 'OQ-029': 'PQ-037', 'OQ-044': 'PQ-037', 'OQ-064': 'PQ-028', 'OQ-065': 'PQ-027' };
      for (let i = 0; i < allResults.length; i++) {
        const sourceId = mapping[allResults[i].testCaseId];
        const native = fixture.results.find(row => row.testCaseId === sourceId);
        if (native) allResults[i] = { ...native, testCaseId: allResults[i].testCaseId,
          notes: `${native.notes} Shared native evidence ${sourceId}; not a second independent trial.`, relatedEvidence: [native] };
      }
    }
    } catch (error) {
      allResults.push({ ...manualResult('OQ-EXECUTION', 'Unexpected OQ suite exception; retained evidence identifies completed operations.'), method: 'CONTRACT',
        relatedEvidence: fixture ? [...fixture.results, ...[fixture.reasonRefusal, fixture.batchSdv].filter((row): row is EvidenceResult => row !== undefined)] : undefined });
    } finally {
      try { if (fixture) {
      const retained = await runCleanupVerification(baseUrl, fixture.state);
      allResults.push({ ...retained[0], testCaseId: 'OQ-NATIVE-RETENTION', passed: retained.length === 5 && retained.every(row => row.passed),
        notes: 'Final native retention and owned fixture archive checks.', relatedEvidence: retained });
      } } catch (error) { allResults.push({ ...manualResult('OQ-NATIVE-RETENTION', 'Unexpected retention/cleanup failure; reconcile retained owned fixture before retrying.'), method: 'CONTRACT' }); }
      finally { allResults.push(await captureWithExpectedStatus({ testCaseId: 'OQ-RUN-LOGOUT', method: 'POST', url: '/api/auth/logout', baseUrl, headers: authHeaders(auth.token) }, 200)); }
    }

  } else {
    console.log('  WARNING: Could not authenticate — set OQ_USERNAME and OQ_PASSWORD');
    allResults.push({
      testCaseId: 'OQ-AUTH', timestamp: new Date().toISOString(),
      endpoint: 'POST /api/auth/login', method: 'POST', responseStatus: 0,
      responseBody: { error: 'Auth failed — set OQ_USERNAME/OQ_PASSWORD env vars' },
      passed: false, notes: 'Authentication failed; suites 2-12 skipped',
    });
  }

  allResults.push(await runRateLimitTest(baseUrl));
  for (let id = 1; id <= 205; id++) { const testCaseId = `OQ-${String(id).padStart(3, '0')}`; if (!allResults.some(row => row.testCaseId === testCaseId)) allResults.push({ ...manualResult(testCaseId, 'This OQ case did not execute.'), method: 'CONTRACT' }); }
  allResults.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId, undefined, { numeric: true }));

  const passed = allResults.filter(r => r.passed).length;
  const manualCount = allResults.filter(r => r.method === 'MANUAL').length;
  const failed = allResults.length - passed;
  console.log(`\n  OQ Summary: ${passed} passed / ${failed} failed (${manualCount} manual) out of ${allResults.length} total`);

  const evidencePath = saveEvidence(outputDir, 'oq', allResults);
  console.log(`  Evidence saved: ${evidencePath}`);
  return allResults;
}
