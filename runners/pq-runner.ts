import { randomUUID } from 'node:crypto';
import { login, qualificationCredentials } from './auth';
import {
  type EvidenceResult,
  enrichResult,
  isRecord,
  manualResult,
  saveEvidence,
  captureWithExpectedStatus,
} from './evidence-capture';
import { cloneStudy, pendingStudy, type StudyWorkspace, type StudyActivationReview, type StudyTransport, expectStudySuccess, nativeId } from './study-definition-client';
import { captureStudyOperation, captureQualificationOperation } from './study-qualification';
import { qualificationOptions, syntheticStudyDefinition } from './qualification-fixture';

/** PQ operator credentials come only from the environment: OQ_USERNAME / OQ_PASSWORD
 * take precedence over PQ_USERNAME / PQ_PASSWORD. There is no built-in account; a
 * missing value refuses the run before any request is made. */
export function pqCredentials(): { username: string; password: string } {
  return qualificationCredentials({ username: process.env.PQ_USERNAME, password: process.env.PQ_PASSWORD },
    { username: 'PQ_USERNAME (or OQ_USERNAME)', password: 'PQ_PASSWORD (or OQ_PASSWORD)' }, 'PQ');
}

function evidence(testCaseId: string, endpoint: string, method: string, status: number, body: unknown, passed: boolean, notes: string): EvidenceResult {
  return { testCaseId, timestamp: new Date().toISOString(), endpoint, method, responseStatus: status, responseBody: body, passed, notes };
}

export interface WorkflowState {
  adminToken: string | null;
  userId: number | null;
  orgId: number | null;
  studyId: number | null;
  studyName: string;
  siteId: number | null;
  subjectId: number | null;
  subjectLabel: string;
  formId: number | null;
  formDataId: number | null;
  visitId: number | null;
  eventDefinitionId: number | null;
  queryId: number | null;
  signatureId: number | null;
  baseUrl: string;
  studyWorkspace?: StudyWorkspace;
  createdStudyCleanupCandidate?: StudyWorkspace;
  formItems?: Record<string, number>;
  crfVersionId?: number;
  qualification?: StudyActivationReview;
  values?: Record<string, unknown>;
  enrollmentRequest?: { studyId: number; label: string; enrollmentDate: string; enrollmentStatus: string; autoScheduleVisits: boolean };
}

export async function runStudySetup(baseUrl: string, state: WorkflowState, qualification?: StudyActivationReview): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  state.qualification = qualification;
  state.baseUrl = baseUrl;

  if (!state.adminToken) {
    for (let i = 1; i <= 10; i++) {
      results.push(manualResult(`PQ-${String(i).padStart(3, '0')}`, 'No admin token available'));
    }
    return results;
  }

  state.studyName = `PQ Validation Study ${Date.now()}`;
  const protocolId = `PQ-PROTO-${Date.now()}-${randomUUID().slice(0, 8)}`;

  // PQ-001: Create a new test study
  const initial = qualification ? syntheticStudyDefinition(protocolId)
    : pendingStudy(state.studyName, protocolId, 'PQ validation test study — created by automated PQ runner');
  // A draft can retain an incomplete clinical design without claiming release.
  if (!qualification) initial.document.study!.versions = [{
    id: 'pq-version', instanceType: 'StudyVersion', versionIdentifier: '1.0',
    rationale: 'Synthetic performance qualification fixture',
    studyDesigns: [{
      id: 'pq-design', instanceType: 'InterventionalStudyDesign', name: 'PQ design',
      studyPhase: { id: 'pq-phase', instanceType: 'AliasCode',
        standardCode: { id: 'pq-phase-code', instanceType: 'Code', decode: 'Phase III' } },
    }],
  }];
  if (!qualification) initial.selection = { versionId: 'pq-version', designId: 'pq-design' };
  const created = await captureStudyOperation('PQ-001', baseUrl, state.adminToken, 'Create and read back canonical draft',
    client => client.create(initial, 'Create synthetic PQ study definition', candidate => { state.createdStudyCleanupCandidate = candidate; }));
  if (created.value) {
    state.studyWorkspace = created.value;
    state.studyId = created.value.summary.studyId;
  }
  results.push(enrichResult(created.evidence, {
    regulatoryRef: '21 CFR 11.10(a) — System validation',
    testDescription: 'Create a new clinical study via API',
    acceptanceCriteria: 'HTTP 201 success=true workspace and HTTP 200 readback preserve the complete draft and native study ID',
  }));

  // PQ-002: Verify study appears in study list
  const pq002 = state.studyWorkspace
    ? (await captureStudyOperation('PQ-002', baseUrl, state.adminToken, 'Find created revision in summary pages',
      client => client.findInSummaries(state.studyWorkspace!))).evidence
    : evidence('PQ-002', '/api/studies', 'GET', 0, null, false, 'Blocked — no verified study from PQ-001');
  results.push(enrichResult(pq002, {
    regulatoryRef: '21 CFR 11.10(a) — System validation',
    testDescription: 'Verify newly created study appears in the study listing',
    acceptanceCriteria: 'Canonical summary pages contain the exact created native ID, revision ID, name and identifier',
  }));

  // PQ-003: Update study configuration
  let pq003 = evidence('PQ-003', '/api/studies/:id', 'PUT', 0, null, false, 'Blocked — no verified study from PQ-001');
  if (state.studyWorkspace) {
    const content = cloneStudy(state.studyWorkspace.revision.content);
    if (qualification) content.execution.extensions.qualificationRun = protocolId;
    else content.document.study!.description = 'PQ validation test study — UPDATED by automated PQ runner';
    const updated = await captureStudyOperation('PQ-003', baseUrl, state.adminToken, 'Replace and read back canonical draft',
      client => client.replace(state.studyWorkspace!, content, 'Review PQ study description change'));
    pq003 = updated.evidence;
    if (updated.value) state.studyWorkspace = updated.value;
  }
  results.push(enrichResult(pq003, {
    regulatoryRef: '21 CFR 11.10(a) — System validation',
    testDescription: 'Update study configuration after creation',
    acceptanceCriteria: 'PUT uses the reviewed baseRevisionToken; the next revision and GET readback preserve the complete edited graph',
  }));

  // PQ-004: Create a study event/visit definition
  let pq004 = evidence('PQ-004', '/api/studies/:id/execution', 'PUT', 0, null, false, 'Blocked — no verified updated study');
  if (state.studyWorkspace && pq003.passed) {
    const executed = await captureStudyOperation('PQ-004', baseUrl, state.adminToken, 'Create and read back native visit',
      client => client.editExecution(state.studyWorkspace!, {
        visits: { upsert: [{ name: 'Screening Visit', ordinal: 1, type: 'scheduled', repeating: false,
          scheduleDay: 0, minDay: -3, maxDay: 3 }], removeIds: [] },
      }, 'Add synthetic PQ screening visit'));
    pq004 = executed.evidence;
    if (executed.value) {
      state.studyWorkspace = executed.value;
      // editExecution and its exact GET readback have verified this native ID.
      state.eventDefinitionId = executed.value.executionContext.visits.find(visit => visit.ordinal === 1)!.studyEventDefinitionId!;
    }
  }
  results.push(enrichResult(pq004, {
    regulatoryRef: '21 CFR 11.10(a) — Validated system with accurate records',
    testDescription: 'Create a visit/event definition for the study schedule',
    acceptanceCriteria: 'Revision-aware execution command and GET readback preserve the visit and its numeric native ID',
  }));

  // PQ-005 creates native fields, checks their identities, assigns this exact
  // version to the visit, then applies and activates the exact reviewed fixture.
  const configured = state.studyWorkspace && pq004.passed
    ? await captureStudyOperation('PQ-005', baseUrl, state.adminToken, 'Create and verify assigned qualification CRF', async client => {
      const form = await client.createForm(state.studyId!, {
        name: `Synthetic PQ demographics ${protocolId}`,
        fields: [
          { name: 'patientInitials', label: 'Synthetic initials', type: 'text', required: true, ordinal: 1 },
          { name: 'dateOfBirth', label: 'Synthetic date', type: 'date', required: true, ordinal: 2 },
          { name: 'weight', label: 'Synthetic weight (kg)', type: 'number', required: false, ordinal: 3, min: 0, max: 300 },
          { name: 'gender', label: 'Synthetic gender', type: 'select', required: true, ordinal: 4,
            options: [{ label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }, { label: 'Other', value: 'Other' }] },
          { name: 'notes', label: 'Synthetic notes', type: 'text', required: false, ordinal: 5 },
        ],
      });
      state.formId = form.crfId; state.crfVersionId = form.crfVersionId; state.formItems = form.items;
      const current = await client.get(state.studyId!);
      const visit = current.executionContext.visits.find(row => row.studyEventDefinitionId === state.eventDefinitionId);
      if (!visit) throw new Error('Qualification visit disappeared before form assignment.');
      let configured = await client.editExecution(current, {
        visits: { upsert: [{ ...visit, crfAssignments: [{ crfId: form.crfId, defaultVersionId: form.crfVersionId,
          required: true, doubleDataEntry: false, hideCrf: false, electronicSignature: false, ordinal: 1 }] }], removeIds: [] },
      }, 'Assign the verified synthetic PQ form version');
      if (qualification) {
        configured = await client.releaseAndApply(configured, { password: qualification.password,
          meaning: 'Approve this synthetic software qualification configuration' }, qualification.reason);
        const reviewed = await client.getActivationReview(configured);
        configured = await client.activateReviewed(configured, { ...qualification,
          activationReviewHash: qualification.activationReviewHash ?? reviewed.executionWitness.reviewHash });
      }
      return configured;
    }) : { evidence: evidence('PQ-005', '/api/forms', 'POST', 0, null, false, 'Blocked: no verified qualification visit') };
  results.push(enrichResult(configured.evidence, {
    regulatoryRef: '21 CFR 11.10(a)', testDescription: 'Create, assign and independently read back the synthetic CRF',
    acceptanceCriteria: qualification
      ? 'Exact native form/version/items and visit assignment; conformant signed release, application and reviewed activation; active readback'
      : 'Exact native form/version/items and visit assignment; draft remains unactivated',
  }));
  if (configured.value) state.studyWorkspace = configured.value;
  if (!qualification || !configured.evidence.passed) {
    for (let i = 6; i <= 10; i++) results.push(manualResult(`PQ-${String(i).padStart(3, '0')}`,
      'Blocked: explicit synthetic qualification and verified release/application/activation are required.'));
    return results;
  }
  results.push(...await runAppliedStudyEnrollment(baseUrl, state));
  return results;
}

/** The same native enrollment path serves PQ and the OQ fixture check. */
export async function runAppliedStudyEnrollment(baseUrl: string, state: WorkflowState): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [], date = new Date().toISOString().slice(0, 10);
  state.subjectLabel = `PQ-SUBJ-${Date.now()}`;
  const step = async (id: string, description: string, action: Parameters<typeof captureStudyOperation>[4]) => {
    const result = await captureStudyOperation(id, baseUrl, state.adminToken!, description, action);
    results.push(result.evidence); return result;
  };
  const enrolled = await step('PQ-006', 'Enroll in this signed, active fixture and verify native subject',
    client => client.enroll(state.studyWorkspace!, state.subjectLabel, date));
  if (enrolled.value) {
    const value = enrolled.value as Awaited<ReturnType<import('./study-definition-client').StudyDefinitionClient['enroll']>>;
    state.subjectId = value.subject.studySubjectId; state.enrollmentRequest = value.request;
  }
  if (!state.subjectId || !state.enrollmentRequest) {
    for (let i = 7; i <= 10; i++) results.push(manualResult(`PQ-${String(i).padStart(3, '0')}`, 'Blocked: enrollment has no verified native subject.'));
    return results;
  }
  await step('PQ-007', 'Verify the exact native study subject and label',
    client => client.readSubject(state.subjectId!, state.studyId!, state.subjectLabel, state.enrollmentRequest!.enrollmentDate));
  await step('PQ-008', 'Reject an exact duplicate enrollment and verify unchanged subject census',
    client => client.rejectDuplicateSubject(state.subjectId!, state.enrollmentRequest!));
  const scheduled = await step('PQ-009', 'Schedule and read back the native patient visit',
    client => client.scheduleVisit(state.subjectId!, state.eventDefinitionId!, date));
  if (scheduled.value) state.visitId = scheduled.value as number;
  if (state.visitId) await step('PQ-010', 'Verify the exact planned visit; no actual date is invented',
    client => client.readVisit(state.subjectId!, state.visitId!, state.eventDefinitionId!, date));
  else results.push(manualResult('PQ-010', 'Blocked: no independently verified scheduled visit.'));
  return results;
}

function demand(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const dataOf = (response: Awaited<ReturnType<StudyTransport>>, status = 200): any => expectStudySuccess(response, status).data;
export const reviewed = (snapshot: any) => ({ expectedExecution: snapshot.execution ?? null,
  expectedObservations: { contract: 'edc-form-observation-preconditions/1', snapshotHash: snapshot.observationSnapshotHash } });

export async function patientForm(request: StudyTransport, state: WorkflowState): Promise<any> {
  if (!state.formDataId) {
    const forms = dataOf(await request('GET', `/events/instance/${state.visitId}/crfs`));
    demand(Array.isArray(forms), 'Native patient-form census is missing.');
    const matches = forms.filter((form: any) => form.crfId === state.formId && form.crfVersionId === state.crfVersionId
      && form.studyEventId === state.visitId && form.studySubjectId === state.subjectId);
    demand(matches.length === 1 && nativeId(matches[0].eventCrfId), 'Missing or ambiguous assigned native patient form.');
    state.formDataId = matches[0].eventCrfId;
  }
  const read = dataOf(await request('GET', `/forms/data/${state.formDataId}`));
  demand(isRecord(read) && read.eventCrfId === state.formDataId && read.studyId === state.studyId
    && read.studySubjectId === state.subjectId && read.studyEventId === state.visitId
    && read.crfId === state.formId && read.crfVersionId === state.crfVersionId
    && isRecord(read.formData) && Array.isArray(read.data) && isRecord(read.lockStatus)
    && /^sha256:[a-f0-9]{64}$/.test(String(read.observationSnapshotHash))
    && read.observationPreconditionContract === 'edc-form-observation-preconditions/1',
  'Native patient form custody or observation precondition is missing/mismatched.');
  return read;
}
function nativeValues(state: WorkflowState, values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => {
    const id = state.formItems?.[name]; demand(nativeId(id), `No verified native field for ${name}.`);
    return [`item_${id}`, value];
  }));
}
function assertValues(state: WorkflowState, read: any, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(nativeValues(state, values))) {
    demand(Object.prototype.hasOwnProperty.call(read.formData, key)
      && read.formData[key] === String(value ?? ''), `Native saved value differs at ${key}.`);
  }
}
async function saveValues(request: StudyTransport, state: WorkflowState, values: Record<string, unknown>, reason: string,
  basis?: any): Promise<any> {
  const before = basis ?? await patientForm(request, state);
  const { expectedExecution, expectedObservations } = reviewed(before);
  const body = { studyId: state.studyId, subjectId: state.subjectId, studyEventId: state.visitId,
    eventCrfId: state.formDataId, crfId: state.formId, formData: nativeValues(state, values),
    reasonForChange: reason, submitAction: 'draft', expectedObservations,
    ...(expectedExecution ? { expectedExecution } : {}) };
  expectStudySuccess(await request('POST', '/forms/save', body), 200);
  const after = await patientForm(request, state); assertValues(state, after, values);
  state.values = { ...state.values, ...values }; return after;
}
function signature(state: WorkflowState) {
  demand(state.qualification?.username && state.qualification.password, 'Explicit synthetic signer credentials are required.');
  return { signatureUsername: state.qualification.username, signaturePassword: state.qualification.password };
}
async function pqStep(state: WorkflowState, id: number, description: string, action: (request: StudyTransport) => Promise<unknown>) {
  const result = (await captureQualificationOperation(`PQ-${String(id).padStart(3, '0')}`, state.baseUrl, state.adminToken!, description, action)).evidence;
  return enrichResult(result, { regulatoryRef: '21 CFR 11.10(a)', testDescription: description,
    acceptanceCriteria: 'All native commands and independent identity, value and state readbacks satisfy the case assertions; absent or failed evidence fails.' });
}
const blocked = (from: number, to: number, reason: string) => Array.from({ length: to - from + 1 }, (_, i) =>
  manualResult(`PQ-${String(from + i).padStart(3, '0')}`, `Blocked: ${reason}`));

export async function runDataEntry(baseUrl: string, state: WorkflowState): Promise<EvidenceResult[]> {
  if (!state.adminToken || !state.subjectId || !state.visitId || !state.formItems) return blocked(11, 25, 'no verified active subject, visit and form');
  const results: EvidenceResult[] = [], step = async (id: number, description: string, action: (r: StudyTransport) => Promise<unknown>) => {
    results.push(await pqStep(state, id, description, action));
  };
  const initial = { patientInitials: 'SY', dateOfBirth: '1990-01-01', weight: 75, gender: 'Other', notes: 'Synthetic software qualification only' };
  await step(11, 'Save native scalar form values and verify independent readback', r => saveValues(r, state, initial, 'Initial synthetic qualification entry'));
  if (!results[0].passed) return [...results, ...blocked(12, 25, 'initial native form save was not verified')];
  await step(12, 'Read back every submitted native field', async r => assertValues(state, await patientForm(r, state), initial));
  await step(13, 'Correct a native value with an explicit reason and readback', r => saveValues(r, state, { weight: 70.5 }, 'PQ verified synthetic weight correction'));
  await step(14, 'Reject an out-of-range value without changing stored data', async r => {
    const before = await patientForm(r, state);
    const response = await r('POST', `/forms/validate-field/${state.formDataId}`, { fieldName: `item_${state.formItems!.weight}`, value: -1, createQueries: false });
    const body = response.body as any;
    demand(response.status === 200 && body?.success === false && body.data?.valid === false
      && Array.isArray(body.data.errors) && body.data.errors.length > 0, 'Out-of-range field was not rejected by native validation.');
    const after = await patientForm(r, state);
    demand(after.observationSnapshotHash === before.observationSnapshotHash, 'Validation preview mutated clinical data.');
  });
  await step(15, 'Roundtrip all configured scalar field types', r => saveValues(r, state, { ...initial, weight: 70.5 }, 'PQ scalar type roundtrip'));
  await step(16, 'Read the exact native form query inventory', async r => {
    const rows = dataOf(await r('GET', `/queries/form/${state.formDataId}`));
    demand(Array.isArray(rows) && rows.every((q: any) => q.eventCrfId === state.formDataId), 'Query inventory is missing or crosses form scope.');
  });
  await step(17, 'Create and independently read back a native item query', async r => {
    const read = await patientForm(r, state), item = read.data.find((row: any) => row.itemId === state.formItems!.weight);
    demand(item && nativeId(item.itemDataId), 'Weight has no native item_data identity.');
    const created = expectStudySuccess(await r('POST', '/queries', { entityType: 'itemData', entityId: item.itemDataId,
      itemDataId: item.itemDataId, itemId: item.itemId, eventCrfId: state.formDataId,
      studyId: state.studyId, subjectId: state.subjectId, description: 'Verify the synthetic qualification weight', queryType: 'Query' }), 201);
    demand(nativeId(created.queryId), 'Native query identity missing.');
    const query = dataOf(await r('GET', `/queries/${created.queryId}`));
    demand(query?.discrepancyNoteId === created.queryId && query.studyId === state.studyId
      && query.eventCrfId === state.formDataId && query.itemId === item.itemId && query.resolutionStatusId === 1, 'Query readback lost native target or state.');
    state.queryId = created.queryId;
  });
  await step(18, 'Propose a resolution and verify native query state', async r => {
    demand(state.queryId, 'No verified native query.');
    expectStudySuccess(await r('POST', `/queries/${state.queryId}/respond`, { description: 'Synthetic source reviewed; the recorded weight is correct.', newStatusId: 3 }), 200);
    const query = dataOf(await r('GET', `/queries/${state.queryId}`));
    demand(query?.discrepancyNoteId === state.queryId && query.resolutionStatusId === 3, 'Query resolution was not persisted.');
  });
  await step(19, 'Close the exact native query with an authorized signature', async r => {
    demand(state.queryId, 'No verified native query.');
    expectStudySuccess(await r('POST', `/queries/${state.queryId}/close-with-signature`, { reason: 'Accept synthetic qualification source review', ...signature(state) }), 200);
    const query = dataOf(await r('GET', `/queries/${state.queryId}`));
    demand(query?.discrepancyNoteId === state.queryId && query.resolutionStatusId === 4, 'Signed query closure not persisted.');
  });
  await step(20, 'Complete the reviewed native form and verify completion', async r => {
    const read = await patientForm(r, state);
    expectStudySuccess(await r('POST', `/forms/${state.formDataId}/complete`, reviewed(read)), 200);
    demand((await patientForm(r, state)).lockStatus.isComplete === true, 'Native form is not complete.');
  });
  await step(21, 'Save a partial correction without dropping other fields', async r => {
    const prior = { ...state.values }; const read = await saveValues(r, state, { notes: 'Synthetic partial correction' }, 'PQ partial update');
    assertValues(state, read, { ...prior, notes: 'Synthetic partial correction' });
  });
  await step(22, 'Reject a stale observation snapshot and preserve the newer value', async r => {
    const stale = await patientForm(r, state);
    const current = await saveValues(r, state, { weight: 71 }, 'PQ competing synthetic correction');
    const { expectedExecution, expectedObservations } = reviewed(stale);
    const response = await r('POST', '/forms/save', { studyId: state.studyId, subjectId: state.subjectId,
      studyEventId: state.visitId, eventCrfId: state.formDataId, crfId: state.formId,
      formData: nativeValues(state, { weight: 80 }), reasonForChange: 'PQ stale write must fail', submitAction: 'draft',
      expectedObservations, ...(expectedExecution ? { expectedExecution } : {}) });
    demand(response.status === 409 && (response.body as any)?.success === false
      && (response.body as any)?.code === 'STUDY_FORM_OBSERVATION_STALE', 'Stale observation write was not rejected by its native precondition.');
    const after = await patientForm(r, state); assertValues(state, after, { weight: 71 });
    demand(after.observationSnapshotHash === current.observationSnapshotHash, 'Rejected stale save changed observations.');
  });
  await step(23, 'Clear optional scalar values and verify the native blank representation', r => saveValues(r, state, { weight: null, notes: '' }, 'PQ explicit optional blanks'));
  await step(24, 'Roundtrip Unicode without corruption', r => saveValues(r, state, { patientInitials: 'ÄÖ', notes: 'Ñoño — 日本語 — 👍' }, 'PQ Unicode preservation'));
  await step(25, 'Roundtrip the declared minimum numeric boundary', r => saveValues(r, state, { weight: 0 }, 'PQ declared minimum boundary'));
  return results;
}

async function signatureProof(r: StudyTransport, state: WorkflowState) {
  const proof = dataOf(await r('GET', `/esignature/status/eventCrf/${state.formDataId}`));
  demand(proof?.contract === 'edc-event-crf-signature-proof/1' && proof.entityId === state.formDataId
    && proof.studyId === state.studyId && proof.studySubjectId === state.subjectId && proof.studyEventId === state.visitId,
  'Native signature proof has missing or mismatched identity.');
  return proof;
}
async function signForm(r: StudyTransport, state: WorkflowState) {
  const read = await patientForm(r, state), credentials = state.qualification!;
  expectStudySuccess(await r('POST', `/forms/${state.formDataId}/complete`, reviewed(read)), 200);
  const complete = await patientForm(r, state);
  const signed = dataOf(await r('POST', '/esignature/sign', { entityType: 'eventCrf', entityId: state.formDataId,
    username: credentials.username, password: credentials.password, meaning: 'approval',
    reasonForSigning: 'Synthetic software qualification approval', ...reviewed(complete) }));
  demand(nativeId(signed?.signatureId), 'Native signature identifier is missing.');
  state.signatureId = signed.signatureId;
  const proof = await signatureProof(r, state);
  demand(proof.isSigned === true && proof.signatureIntegrityValid === true && proof.integrityStatus === 'verified'
    && proof.activeSignature?.signatureId === state.signatureId && proof.activeSignature.signerUsername === credentials.username,
  'Signature lacks a verified current native proof.');
}
async function rejectedLockedEdit(r: StudyTransport, state: WorkflowState, flag: 'frozen' | 'locked') {
  const before = await patientForm(r, state); demand(before.lockStatus[flag] === true, `Native form is not ${flag}.`);
  const { expectedExecution, expectedObservations } = reviewed(before);
  const response = await r('POST', '/forms/save', { studyId: state.studyId, subjectId: state.subjectId,
    studyEventId: state.visitId, eventCrfId: state.formDataId, crfId: state.formId,
    formData: nativeValues(state, { weight: 77 }), reasonForChange: `PQ ${flag} protection`, submitAction: 'draft',
    expectedObservations, ...(expectedExecution ? { expectedExecution } : {}) });
  demand(response.status === 403 && (response.body as any)?.success === false
    && (response.body as any)?.code === (flag === 'frozen' ? 'FORM_FROZEN' : 'FORM_LOCKED'), `${flag} edit was not refused by its native lifecycle guard.`);
  const after = await patientForm(r, state);
  demand(after.observationSnapshotHash === before.observationSnapshotHash && after.lockStatus[flag] === true,
    `Rejected ${flag} edit did not preserve native observations.`);
}
export async function runReviewAndSignature(baseUrl: string, state: WorkflowState): Promise<EvidenceResult[]> {
  if (!state.adminToken || !state.formDataId || !state.qualification) return blocked(26, 35, 'no verified form or explicit synthetic signer');
  const results: EvidenceResult[] = [], step = async (id: number, description: string, action: (r: StudyTransport) => Promise<unknown>) => {
    results.push(await pqStep(state, id, description, action));
  };
  await step(26, 'Verify source data and read back the exact native SDV record', async r => {
    expectStudySuccess(await r('PUT', `/sdv/${state.formDataId}/verify`, {}), 200);
    const record = dataOf(await r('GET', `/sdv/${state.formDataId}`));
    demand(record?.eventCrfId === state.formDataId && record.studySubjectId === state.subjectId
      && record.sdvStatus === true && nativeId(record.sdvUpdateId), 'Native SDV identity/verifier is missing.');
  });
  await step(27, 'Sign the exact reviewed form and verify its native integrity proof', r => signForm(r, state));
  await step(28, 'Read the current signature manifestation and content linkage', async r => {
    const proof = await signatureProof(r, state), sig = proof.activeSignature;
    demand(proof.signatureIntegrityValid === true && sig?.signatureId === state.signatureId
      && sig.signerUsername === state.qualification!.username && sig.meaning === 'approval'
      && typeof sig.signedAt === 'string' && Number.isFinite(Date.parse(sig.signedAt))
      && typeof sig.contentHash === 'string' && /^[a-f0-9]{64}$/.test(sig.contentHash), 'Signature manifestation or content linkage is incomplete.');
  });
  await step(29, 'A material correction invalidates the old signature, then requires fresh reviewed signing', async r => {
    demand(state.signatureId, 'No verified signature to invalidate.');
    const old = state.signatureId;
    await saveValues(r, state, { notes: 'Synthetic correction after signing' }, 'PQ signed record correction');
    const invalid = await signatureProof(r, state);
    demand(invalid.isSigned === false && invalid.activeSignature === null, 'Material correction left the old signature valid.');
    await signForm(r, state); demand(state.signatureId !== old, 'Fresh signing reused the invalidated signature identity.');
  });
  await step(30, 'Freeze the signed native form and verify its readback', async r => {
    expectStudySuccess(await r('POST', `/data-locks/freeze/${state.formDataId}`, { reason: 'Freeze synthetic qualification form', ...signature(state) }), 200);
    demand((await patientForm(r, state)).lockStatus.frozen === true, 'Freeze was not persisted.');
  });
  await step(31, 'Frozen form rejects writes without changing values', r => rejectedLockedEdit(r, state, 'frozen'));
  await step(32, 'Unfreeze by native signed workflow and verify readback', async r => {
    expectStudySuccess(await r('POST', `/data-locks/freeze/${state.formDataId}/unfreeze`, { reason: 'Unfreeze synthetic qualification form', ...signature(state) }), 200);
    demand((await patientForm(r, state)).lockStatus.frozen === false, 'Unfreeze was not persisted.');
  });
  await step(33, 'Lock the native form with its signed lifecycle workflow', async r => {
    expectStudySuccess(await r('POST', '/data-locks', { eventCrfId: state.formDataId, reason: 'Lock synthetic qualification form', ...signature(state) }), 200);
    demand((await patientForm(r, state)).lockStatus.locked === true, 'Lock was not persisted.');
  });
  await step(34, 'Locked form rejects writes without changing values', r => rejectedLockedEdit(r, state, 'locked'));
  await step(35, 'Export exact native source rows and verify submitted patient values', async r => {
    const snapshot = dataOf(await r('GET', `/data-cuts/raw-store-snapshot?studyId=${state.studyId}`));
    demand(snapshot?.schemaVersion === 'edc-raw-store-snapshot/1' && snapshot.studyId === state.studyId
      && snapshot.scope?.complete === true && snapshot.scope.nativeStudyId === state.studyId && Array.isArray(snapshot.tables), 'Native export is incomplete or wrong-scope.');
    const table = snapshot.tables.find((t: any) => t.table === 'item_data');
    demand(table && Array.isArray(table.rows) && table.count === table.rows.length
      && state.values && Object.keys(state.values).length === Object.keys(state.formItems ?? {}).length, 'Native item_data export or expected field census is incomplete.');
    const rows = table.rows.map((row: any) => JSON.parse(row.nativeJson)).filter((row: any) => row.event_crf_id === state.formDataId && row.deleted !== true);
    for (const [name, value] of Object.entries(state.values ?? {})) {
      const matches = rows.filter((row: any) => row.item_id === state.formItems![name]);
      demand(matches.length === 1 && matches[0].value === String(value ?? ''), `Native export value differs at ${name}.`);
    }
  });
  return results;
}

export async function runCleanupVerification(baseUrl: string, state: WorkflowState, archive = true): Promise<EvidenceResult[]> {
  if (!state.adminToken || !state.formDataId) return [...blocked(36, 39, 'no verified native patient form'), ...(archive ? [await archiveOwnedStudy(state)] : [])];
  const results: EvidenceResult[] = [], step = async (id: number, description: string, action: (r: StudyTransport) => Promise<unknown>) => {
    results.push(await pqStep(state, id, description, action));
  };
  await step(36, 'Read scoped native audit entries for this workflow', async r => {
    const rows = dataOf(await r('GET', `/audit/form/${state.formDataId}`));
    demand(Array.isArray(rows) && rows.length > 0 && rows.some((row: any) => row.eventCrfId === state.formDataId
      && row.studyId === state.studyId && nativeId(row.userId) && row.auditDate), 'Scoped native audit evidence is missing.');
  });
  await step(37, 'Verify the exact original/corrected weight, reason, actor and native visit in audit', async r => {
    const rows = dataOf(await r('GET', `/audit/form/${state.formDataId}`));
    demand(Array.isArray(rows) && rows.some((row: any) => row.itemId === state.formItems!.weight
      && row.eventCrfId === state.formDataId && row.studyEventId === state.visitId
      && row.oldValue === '75' && row.newValue === '70.5' && row.reasonForChange === 'PQ verified synthetic weight correction'
      && nativeId(row.userId)), 'Exact weight correction audit evidence is missing.');
  });
  await step(38, 'Verify the exact retained native query remains closed', async r => {
    demand(state.queryId, 'No verified native query.');
    const query = dataOf(await r('GET', `/queries/${state.queryId}`));
    demand(query?.discrepancyNoteId === state.queryId && query.eventCrfId === state.formDataId
      && query.resolutionStatusId === 4, 'Retained query identity/state mismatch.');
  });
  await step(39, 'Verify the final signed native form remains integrity-checked', async r => {
    const proof = await signatureProof(r, state);
    demand(proof.isSigned === true && proof.signatureIntegrityValid === true && proof.integrityStatus === 'verified'
      && proof.activeSignature?.signatureId === state.signatureId,
      'The retained final signature is not verified.');
  });
  if (archive) results.push(await archiveOwnedStudy(state));
  return results;
}

export async function archiveOwnedStudy(state: WorkflowState): Promise<EvidenceResult> {
  return pqStep(state, 40, 'Archive only this owned synthetic fixture and verify native retained state', async r => {
    const owned = state.studyWorkspace ?? state.createdStudyCleanupCandidate;
    const studyId = owned?.summary.studyId;
    demand(owned?.revision.content.execution.extensions.syntheticFixture === true && nativeId(studyId)
      && (!state.studyWorkspace || studyId === state.studyId), 'Only the owned synthetic qualification study may be archived.');
    const before = dataOf(await r('GET', `/studies/${studyId}`));
    demand(before?.summary?.studyId === studyId && before.summary.primaryIdentifier === owned.summary.primaryIdentifier
      && before.revision?.content?.execution?.extensions?.syntheticFixture === true, 'Native archive prerequisite no longer matches the owned synthetic identity.');
    expectStudySuccess(await r('DELETE', `/studies/${studyId}`), 200);
    const read = dataOf(await r('GET', `/studies/${studyId}`));
    demand(read?.summary?.studyId === studyId && read.summary.primaryIdentifier === owned.summary.primaryIdentifier
      && read.revision?.content?.execution?.extensions?.syntheticFixture === true && read.executionContext?.entityStatus?.id === 5,
      'Synthetic archive was not confirmed by native study readback.');
  });
}

export function createWorkflowState(baseUrl: string, adminToken: string | null = null): WorkflowState {
  return {
    adminToken,
    userId: null,
    orgId: null,
    studyId: null,
    studyName: '',
    siteId: null,
    subjectId: null,
    subjectLabel: '',
    formId: null,
    formDataId: null,
    visitId: null,
    eventDefinitionId: null,
    queryId: null,
    signatureId: null,
    baseUrl,
  };
}

export async function run(outputDir: string, baseUrl: string, _workspaceRoot?: string, qualificationFlags: readonly string[] = []): Promise<EvidenceResult[]> {
  const { username: pqUsername, password: pqPassword } = pqCredentials();
  const qualification = qualificationFlags.length ? {
    ...qualificationOptions(qualificationFlags, baseUrl), username: pqUsername, password: pqPassword,
    reason: 'Execute the explicitly requested synthetic software qualification fixture',
  } : undefined;

  const state = createWorkflowState(baseUrl);

  const authentication = await login(baseUrl, pqUsername, pqPassword, 'PQ-000');
  const loginResult = authentication.session;

  if (!loginResult) {
    const loginEvidence = authentication.evidence;
    saveEvidence(outputDir, 'pq', [enrichResult(loginEvidence, {
      regulatoryRef: '21 CFR 11.10(d) — System access limited to authorized individuals',
      testDescription: 'Authenticate test user for PQ workflow execution',
      acceptanceCriteria: 'Login returns valid access token',
    })]);
    return [loginEvidence];
  }

  state.adminToken = loginResult.token;
  state.userId = loginResult.userId;
  state.orgId = loginResult.orgId;

  const allResults: EvidenceResult[] = [];

  const loginSuccess = authentication.evidence;
  allResults.push(enrichResult(loginSuccess, {
    regulatoryRef: '21 CFR 11.10(d) — System access limited to authorized individuals',
    testDescription: 'Authenticate test user for PQ workflow execution',
    acceptanceCriteria: 'Login returns valid access token with user and organization context',
  }));

  const suites: Array<(url: string, s: WorkflowState) => Promise<EvidenceResult[]>> = [
    (url, current) => runStudySetup(url, current, qualification),
    runDataEntry,
    runReviewAndSignature,
  ];

  try {
  for (const [suiteIndex, suite] of suites.entries()) {
    try {
      const results = await suite(baseUrl, state);
      allResults.push(...results);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      allResults.push(evidence(
        `PQ-ERR-${suiteIndex + 1}`, baseUrl, 'SUITE', 0, { error: msg }, false,
        `PQ test suite threw unexpected error: ${msg}`,
      ));
    }
  }

  } finally {
    try { allResults.push(...await runCleanupVerification(baseUrl, state)); }
    catch { allResults.push(evidence('PQ-CLEANUP-ERROR', baseUrl, 'CONTRACT', 0, null, false, 'Unexpected cleanup exception; reconcile owned fixture before retrying.')); }
    finally { allResults.push(await captureWithExpectedStatus({ testCaseId: 'PQ-LOGOUT', baseUrl, method: 'POST', url: '/api/auth/logout', headers: { Authorization: `Bearer ${state.adminToken}` } }, 200)); }
  }
  for (let id = 1; id <= 40; id++) { const testCaseId = `PQ-${String(id).padStart(3, '0')}`;
    if (!allResults.some(row => row.testCaseId === testCaseId)) allResults.push({ ...manualResult(testCaseId, 'PQ case did not execute.'), method: 'CONTRACT' }); }
  allResults.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId, undefined, { numeric: true }));
  saveEvidence(outputDir, 'pq', allResults);
  return allResults;
}
