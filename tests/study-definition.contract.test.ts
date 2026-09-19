import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStudyDefinitionContent } from '@accura-trial/shared-types/usdm/validation';
import {
  StudyDefinitionClient, pendingStudy, cloneStudy, readStudyWorkspace, readStudySummaryPage,
  assertEnrollmentReady, type StudyWorkspace, type StudyContent, type StudyResponse,
  studyActivationReviewHash, readStudyActivationSnapshot, type StudyActivationSnapshot,
} from '../runners/study-definition-client';
import { qualificationOptions, syntheticStudyDefinition } from '../runners/qualification-fixture';

import { workspace, queued, response } from './study-contract-fixtures';

import { activationSnapshot, activationResponse, appliedFixture } from './activation-review-fixtures';

test('create/read/replace carries the entire canonical graph and reviewed token', async () => {
  const content = pendingStudy('Synthetic µg — 東京 🧪', 'QUAL-OWNED', 'Ω'.repeat(60000));
  content.execution.enrollment = { target: 0, parameters: { absentElsewhere: '', nullable: null, disabled: 'false' } };
  content.execution.extensions = { enabled: false, zero: 0, nullable: null, ordered: ['x', 'x', 'é'], nested: { empty: [] } };
  content.document.study!.versions = [{ id: 'v', instanceType: 'StudyVersion', studyDesigns: [
    { id: 'd1', instanceType: 'ObservationalStudyDesign', name: '一', description: null },
    { id: 'd2', instanceType: 'ObservationalStudyDesign', name: '二', description: '' },
  ] }];
  content.selection = { versionId: 'v', designId: 'd2' };
  const first = workspace(content);
  const changed = cloneStudy(content);
  changed.document.study!.description = 'Reviewed description';
  const second = workspace(changed, 42, 2);
  const { client, calls } = queued(response(first, 201), response(first), response(second), response(second));
  const created = await client.create(content, 'Create synthetic draft');
  const updated = await client.replace(created, changed, 'Reviewed change');
  assert.deepEqual(updated.revision.content, changed);
  assert.equal(updated.summary.studyId, 42);
  assert.deepEqual(calls.map(call => [call.method, call.path]), [
    ['POST', '/studies'], ['GET', '/studies/42'], ['PUT', '/studies/42'], ['GET', '/studies/42'],
  ]);
  assert.deepEqual(calls[0].body, { content, reason: 'Create synthetic draft' });
  assert.deepEqual(calls[2].body, { content: changed, reason: 'Reviewed change', baseRevisionToken: first.revision.revisionToken });
  assert.equal('description' in calls[2].body, false);
  assert.equal('missing' in updated.revision.content.execution.extensions, false);
});

for (const status of [0, 200, 400, 401, 403, 404, 409, 422, 500, 504]) {
  test(`creation does not treat HTTP ${status} as HTTP 201 success`, async () => {
    const content = pendingStudy('Synthetic', 'QUAL');
    const { client, calls } = queued(response(workspace(content), status));
    await assert.rejects(client.create(content, 'Create'), /requires HTTP 201/);
    assert.equal(calls.length, 1);
  });
}
for (const body of [{}, { success: false }, { success: true }, { success: true, data: { studyId: 42 } }]) {
  test(`missing/flat/failed creation envelope fails: ${JSON.stringify(body)}`, async () => {
    await assert.rejects(queued({ status: 201, body }).client.create(pendingStudy('Synthetic', 'QUAL'), 'Create'));
  });
}

test('acknowledged creation with lossy null/false/zero/Unicode content fails', async () => {
  const content = pendingStudy('Synthetic 🧪', 'QUAL');
  content.execution.extensions = { nil: null, bool: false, zero: 0, text: 'µg東京'.repeat(20000) };
  for (const key of ['nil', 'bool', 'zero', 'text']) {
    const actual = workspace(content);
    delete actual.revision.content.execution.extensions[key];
    await assert.rejects(queued(response(actual, 201)).client.create(content, 'Create'), /complete requested draft/);
  }
});

test('readback rejects another native study and a concurrently advanced revision', async () => {
  const content = pendingStudy('Synthetic', 'QUAL'), first = workspace(content);
  await assert.rejects(queued(response(first, 201), response(workspace(content, 99))).client.create(content, 'Create'), /different native study/);
  await assert.rejects(queued(response(first, 201), response(workspace(content, 42, 2))).client.create(content, 'Create'), /readback differs/);
});

test('revision conflict is explicit and never retried with a newer token', async () => {
  const content = pendingStudy('Synthetic', 'QUAL'), before = workspace(content);
  const { client, calls } = queued({ status: 409, body: { success: false, code: 'STUDY_DEFINITION_REVISION_CONFLICT', message: 'sensitive source text' } });
  await assert.rejects(client.replace(before, content, 'Edit'), error =>
    error instanceof Error && error.message.includes('STUDY_DEFINITION_REVISION_CONFLICT') && !error.message.includes('sensitive'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.baseRevisionToken, before.revision.revisionToken);
});

test('a nominal update without a new revision or with changed application fails', async () => {
  const content = pendingStudy('Synthetic', 'QUAL'), before = workspace(content);
  await assert.rejects(queued(response(before)).client.replace(before, content, 'Edit'), /next revision/);
  const after = workspace(content, 42, 2);
  after.executionContext.appliedApplicationId = '00000000-0000-4000-8000-000000000999';
  await assert.rejects(queued(response(after)).client.replace(before, content, 'Edit'), /unexpectedly changed/);
});

test('execution uses its reviewed token and preserves explicit version IDs and false/zero/null', async () => {
  const content = pendingStudy('Synthetic', 'QUAL'), before = workspace(content), after = workspace(content, 42, 2);
  const visit = { name: 'V', ordinal: 0, type: 'scheduled', repeating: false, scheduleDay: 0, minDay: -3, maxDay: null,
    crfAssignments: [{ crfId: 7, defaultVersionId: 71, required: false, doubleDataEntry: false, electronicSignature: false, hideCrf: false, ordinal: 0 }] };
  const site = { name: 'Site', uniqueIdentifier: 'SITE-Q', facilityZip: '00100', expectedTotalEnrollment: 0 };
  after.executionContext.visits = [{ ...visit, studyEventDefinitionId: 901 }];
  after.executionContext.sites = [{ ...site, studyId: 902 }];
  const { client, calls } = queued(response(after), response(after));
  const changes = { visits: { upsert: [visit], removeIds: [] }, sites: { upsert: [site], archiveIds: [] } };
  const saved = await client.editExecution(before, changes, 'Review native setup');
  assert.equal(saved.executionContext.visits[0].studyEventDefinitionId, 901);
  assert.equal(saved.executionContext.sites[0].studyId, 902);
  assert.deepEqual(calls[0], { method: 'PUT', path: '/studies/42/execution',
    body: { ...changes, baseRevisionToken: before.revision.revisionToken, reason: 'Review native setup' } });
});

test('execution cannot infer an unloaded collection or missing native assignment', async () => {
  const content = pendingStudy('Synthetic', 'QUAL'), before = workspace(content);
  before.executionContext.loaded.visits = false;
  const empty = queued();
  await assert.rejects(empty.client.editExecution(before, { visits: { upsert: [], removeIds: [] } }, 'Edit'), /unloaded/);
  assert.equal(empty.calls.length, 0);
  before.executionContext.loaded.visits = true;
  const after = workspace(content, 42, 2);
  after.executionContext.visits = [{ name: 'V', ordinal: 1, type: 'scheduled', repeating: false,
    studyEventDefinitionId: 6, crfAssignments: [] }];
  await assert.rejects(queued(response(after)).client.editExecution(before, {
    visits: { upsert: [{ name: 'V', ordinal: 1, type: 'scheduled', repeating: false,
      crfAssignments: [{ crfId: 7, defaultVersionId: 71, required: false, doubleDataEntry: false,
        electronicSignature: false, hideCrf: false, ordinal: 1 }] }], removeIds: [] },
  }, 'Edit'), /assigned native CRF/);
});

test('summary lookup traverses canonical pages and keeps native identity separate from USDM identity', async () => {
  const wanted = workspace(pendingStudy('Synthetic', 'QUAL')), other = workspace(pendingStudy('Other', 'OTHER'), 41);
  const { client, calls } = queued(
    { status: 200, body: { success: true, data: { studies: [other.summary], total: 2, page: 1, pageSize: 1 } } },
    { status: 200, body: { success: true, data: { studies: [wanted.summary], total: 2, page: 2, pageSize: 1 } } },
  );
  assert.equal((await client.findInSummaries(wanted)).studyId, 42);
  assert.match(calls[1].path, /page=2&limit=100&search=QUAL/);
  assert.throws(() => readStudySummaryPage({ status: 200, body: { success: true, data: [] } }), /summary page/);
});

test('release refusal cannot lead to apply or activation', async () => {
  const content = syntheticStudyDefinition('QUAL'), before = workspace(content);
  const { client, calls } = queued({ status: 422, body: { success: false, code: 'STUDY_DEFINITION_VALIDATION_FAILED' } });
  await assert.rejects(client.releaseAndApply(before, { password: 'synthetic-only', meaning: 'Review' }, 'Review'), /VALIDATION_FAILED/);
  assert.deepEqual(calls.map(call => call.path), ['/studies/42/definition/release']);
});

test('signed release/application/activation use exact IDs and do not invent acknowledgments', async () => {
  const content = syntheticStudyDefinition('QUAL'), before = workspace(content);
  const released = workspace(content, 42, 2);
  // Only the transport is mocked here; this test does not run or manufacture CORE evidence.
  released.summary.definitionState = 'released';
  released.revision.state = 'released'; released.revision.validation.releaseReady = true;
  const applied = workspace(content, 42, 3);
  applied.executionContext.appliedApplicationId = '00000000-0000-4000-8000-000000000777';
  applied.executionContext.appliedDefinitionRevisionId = released.revision.revisionId;
  applied.executionContext.appliedExecutionConfiguration = cloneStudy(content.execution);
  const active = cloneStudy(applied);
  active.summary.entityStatus = active.executionContext.entityStatus = { id: 1, label: 'available' };
  const snapshot = activationSnapshot(applied, released.revision);
  const { client, calls } = queued(response(released), response(released), response(applied), response(applied),
    activationResponse(snapshot), { status: 200, body: { success: true } }, response(active));
  const result = await client.releaseAndApply(before, { password: 'synthetic-only', meaning: 'Review' }, 'Review synthetic');
  assert.throws(() => assertEnrollmentReady(result), /not available/);
  await client.activateReviewed(result, { username: 'synthetic-human', password: 'synthetic-only', reason: 'Reviewed synthetic configuration' });
  assert.equal(calls[2].body.baseRevisionToken, released.revision.revisionToken);
  assert.equal(calls[2].body.releasedRevisionId, released.revision.revisionId);
  assert.deepEqual(calls[2].body.applicability, { scope: 'new-enrolments', siteScope: 'study-and-inheriting-sites', existingSubjects: 'retain-current', effective: 'immediate' });
  assert.equal(calls[5].path, '/forms/import-study-bundle/42/activate');
  assert.equal(calls[4].path, '/studies/42/activation-review');
  assert.equal(calls[5].body.appliedDefinitionRevisionId, released.revision.revisionId);
  assert.equal(calls[5].body.activationReviewHash, snapshot.executionWitness.reviewHash);
  assert.equal('signatureMeaning' in calls[5].body, false); // Guarded route owns its controlled action meaning.
  assert.equal('acknowledgeUngoverned' in calls[5].body, false);
  assert.equal('acknowledgeIncomplete' in calls[5].body, false);
});

test('activation refusal stops without implicit retry/ack and pending readback cannot pass', async () => {
  const before = appliedFixture();
  const review = { username: 'synthetic', password: 'synthetic-only', reason: 'Explicit synthetic review' };
  const blocked = queued(activationResponse(activationSnapshot(before)), { status: 409, body: { success: false, ungoverned: true } });
  await assert.rejects(blocked.client.activateReviewed(before, review), /HTTP 409/);
  assert.equal(blocked.calls.length, 2);
  await assert.rejects(queued(activationResponse(activationSnapshot(before)), { status: 200, body: { success: true } }, response(before)).client.activateReviewed(before, review), /not available/);
});

for (const [name, mutate] of [
  ['head token', (value: StudyActivationSnapshot) => { value.workspace.revision.revisionToken = '00000000-0000-4000-8000-000000000999'; }],
  ['native study identity', (value: StudyActivationSnapshot) => { value.workspace.summary.studyId = value.workspace.executionContext.identity.studyId = 99; }],
  ['applied release absent', (value: StudyActivationSnapshot) => { value.appliedRevision = null; }],
  ['release readiness absent', (value: StudyActivationSnapshot) => { value.appliedRevision!.validation.releaseReady = false; }],
  ['applied manifest missing', (value: StudyActivationSnapshot) => { delete value.appliedRevision!.manifestHash; }],
  ['applied content changed', (value: StudyActivationSnapshot) => { value.appliedRevision!.content.document.study!.description = 'Unreviewed'; }],
  ['displayed definition changed', (value: StudyActivationSnapshot) => { value.bundle.definition.document.study!.description = 'Unreviewed'; }],
  ['witness profile', (value: StudyActivationSnapshot) => { Object.assign(value.executionWitness, { profile: 'unknown' }); }],
  ['witness native ID', (value: StudyActivationSnapshot) => { value.executionWitness.studyId = 99; }],
  ['witness applied revision', (value: StudyActivationSnapshot) => { value.executionWitness.appliedDefinitionRevisionId = value.workspace.revision.revisionId; }],
  ['witness application', (value: StudyActivationSnapshot) => { value.executionWitness.appliedApplicationId = '00000000-0000-4000-8000-000000000999'; }],
  ['execution hash differs', (value: StudyActivationSnapshot) => { value.executionWitness.currentExecutionHash = `sha256:${'c'.repeat(64)}`; }],
  ['execution witness refuses', (value: StudyActivationSnapshot) => { value.executionWitness.matchesApplied = false; }],
  ['review hash missing prefix', (value: StudyActivationSnapshot) => { value.executionWitness.reviewHash = 'd'.repeat(64); }],
  ['review digest differs', (value: StudyActivationSnapshot) => { value.executionWitness.reviewHash = `sha256:${'d'.repeat(64)}`; }],
  ['nested metadata changed', (value: StudyActivationSnapshot) => { value.bundle.execution.extensions = { native: { date_updated: 'Meaningful nested metadata', zero: 0, flag: false, nil: null } }; }],
] as const) {
  test(`activation refuses ${name} before POST without substituting a fresh acknowledgment`, async () => {
    const before = appliedFixture(), snapshot = activationSnapshot(before); mutate(snapshot);
    const { client, calls } = queued(activationResponse(snapshot));
    await assert.rejects(client.activateReviewed(before, {
      username: 'synthetic-human', password: 'synthetic-only', reason: 'Review synthetic configuration',
      acknowledgeIncomplete: true, acknowledgeUngoverned: true,
    }));
    assert.deepEqual(calls.map(call => [call.method, call.path]), [['GET', '/studies/42/activation-review']]);
  });
}

test('activation review GET must be a successful authoritative envelope', async () => {
  const before = appliedFixture();
  for (const rejected of [
    { status: 404, body: { success: false } }, { status: 200, body: { success: false } },
    { status: 200, body: { success: true, data: before } },
  ]) {
    const { client, calls } = queued(rejected);
    await assert.rejects(client.getActivationReview(before));
    assert.equal(calls.length, 1);
  }
});

test('activation validates all displayed form mappings and preserves exact native versions and metadata', () => {
  const before = appliedFixture(), snapshot = activationSnapshot(before);
  snapshot.bundle.execution.forms.forms = [{
    refKey: 'native-form', name: 'Synthetic form', sections: [], fields: [], editChecks: [],
    validationRuleRecords: [], formLinks: [], repeating: false,
  }];
  snapshot.formMappings = [{ refKey: 'native-form', crfId: 7, crfVersionId: 71, collection: 'forms', sourceIndex: 0 }];
  snapshot.bundle.execution.extensions = { nested: { units: 'µg/L', regex: '^(?:東京|a{300})$', zero: 0, missing: null, disabled: false } };
  snapshot.executionWitness.reviewHash = studyActivationReviewHash(snapshot);
  const original = cloneStudy(snapshot);
  assert.deepEqual(readStudyActivationSnapshot(activationResponse(snapshot), before), original);
  for (const mutate of [
    (value: StudyActivationSnapshot) => { value.formMappings = []; },
    (value: StudyActivationSnapshot) => { value.formMappings[0].sourceIndex = 1; },
    (value: StudyActivationSnapshot) => { value.formMappings[0].refKey = 'wrong-form'; },
    (value: StudyActivationSnapshot) => { value.formMappings[0].crfVersionId = 0; },
    (value: StudyActivationSnapshot) => { value.formMappings.push(cloneStudy(value.formMappings[0])); },
  ]) {
    const changed = cloneStudy(snapshot); mutate(changed);
    changed.executionWitness.reviewHash = studyActivationReviewHash(changed);
    assert.throws(() => readStudyActivationSnapshot(activationResponse(changed), before), /form/);
  }
  const edited = cloneStudy(snapshot); edited.formMappings[0].crfVersionId = 72;
  assert.throws(() => readStudyActivationSnapshot(activationResponse(edited), before), /hash does not bind/);
  assert.deepEqual(snapshot, original);
});

test('generated export clocks remain outside the review digest while the original source envelope survives', () => {
  const before = appliedFixture(), snapshot = activationSnapshot(before);
  snapshot.bundle.exportedAt = '2026-09-10T00:00:00.000Z';
  snapshot.bundle.execution.forms.exportedAt = '2026-09-10T00:00:00.000Z';
  snapshot.bundle.execution.forms.exportedBy = 'another export invocation';
  snapshot.bundle.source.payloads = [];
  assert.equal(studyActivationReviewHash(snapshot), snapshot.executionWitness.reviewHash);
  assert.deepEqual(readStudyActivationSnapshot(activationResponse(snapshot), before).bundle, snapshot.bundle);
});

test('explicit operator review hash cannot be refreshed silently and acknowledgments stay independent', async () => {
  const before = appliedFixture(), snapshot = activationSnapshot(before), active = cloneStudy(before);
  active.summary.entityStatus = active.executionContext.entityStatus = { id: 1, label: 'available' };
  const rejected = queued(activationResponse(snapshot));
  await assert.rejects(rejected.client.activateReviewed(before, {
    username: 'synthetic', password: 'synthetic-only', reason: 'Explicit reviewed configuration', activationReviewHash: `sha256:${'e'.repeat(64)}`,
  }), /explicitly reviewed activation hash changed/);
  assert.equal(rejected.calls.length, 1);
  const { client, calls } = queued(activationResponse(snapshot), { status: 200, body: { success: true } }, response(active));
  await client.activateReviewed(before, {
    username: 'synthetic', password: 'synthetic-only', reason: 'Explicit reviewed configuration',
    activationReviewHash: snapshot.executionWitness.reviewHash, acknowledgeUngoverned: true, acknowledgeIncomplete: false,
  });
  assert.equal(calls[1].body.activationReviewHash, snapshot.executionWitness.reviewHash);
  assert.equal(calls[1].body.acknowledgeUngoverned, true);
  assert.equal(calls[1].body.acknowledgeIncomplete, false);
});

test('qualification fixture and production flags are explicit; no flag grants unknown acknowledgments', () => {
  const fixture = syntheticStudyDefinition('LOCAL-QUAL');
  assert.ok(fixture.document.study && typeof fixture.document.study.name === 'string');
  assert.match(fixture.document.study.name, /synthetic/i);
  assert.equal(fixture.execution.identification.nativeIdentifier, 'LOCAL-QUAL');
  assert.throws(() => qualificationOptions([], 'http://localhost:3100'), /synthetic-qualification/);
  assert.throws(() => qualificationOptions(['--synthetic-qualification'], 'https://qualification.invalid'), /allow-production/);
  assert.deepEqual(qualificationOptions(['--synthetic-qualification'], 'http://127.0.0.1:3100'), {});
  assert.deepEqual(qualificationOptions(['--synthetic-qualification', '--allow-production-qualification', '--acknowledge-ungoverned'],
    'https://qualification.invalid'), { acknowledgeUngoverned: true });
});

test('malformed native context and revision identities are never treated as old flat DTOs', () => {
  const original = workspace(pendingStudy('Synthetic', 'QUAL'));
  const mismatched = cloneStudy(original); mismatched.executionContext.identity.studyId = 77;
  assert.throws(() => readStudyWorkspace(response(mismatched)), /native execution/);
  const invalidToken = cloneStudy(original); invalidToken.revision.revisionToken = 'best-effort-token';
  assert.throws(() => readStudyWorkspace(response(invalidToken)), /study revision/);
});

test('shared draft contract rejects invalid execution and source custody before sending a command', async () => {
  const execution = pendingStudy('Synthetic', 'QUAL');
  Object.assign(execution.execution.facility, { postalCode: 100 }); // Simulate an untyped caller.
  const custody = pendingStudy('Synthetic', 'QUAL');
  custody.sourceArtifacts = [{
    artifactId: '00000000-0000-4000-8000-000000000555', kind: 'study-bundle',
    sha256: 'invalid-hash', byteLength: 0, mediaType: 'application/json', sourceSystem: 'synthetic-test',
  }];
  for (const content of [execution, custody]) {
    const original = cloneStudy(content), before = workspace(pendingStudy('Synthetic', 'QUAL'));
    const { client, calls } = queued();
    await assert.rejects(client.create(content, 'Invalid untyped draft'), /shared draft contract/);
    await assert.rejects(client.replace(before, content, 'Invalid untyped replacement'), /shared draft contract/);
    assert.deepEqual(calls, []);
    assert.deepEqual(content, original);
  }
});

test('shared draft contract rejects malformed nested USDM despite server draftValid=true', () => {
  const malformed = workspace(syntheticStudyDefinition('QUAL'));
  assert.equal(malformed.revision.validation.draftValid, true);
  const population = malformed.revision.content.document.study!.versions![0].studyDesigns![0].population!;
  Object.assign(population, { includesHealthySubjects: 'yes' }); // Untrusted JSON must use a boolean.
  const original = cloneStudy(malformed);
  assert.throws(() => readStudyWorkspace(response(malformed)), /shared draft contract/);
  assert.deepEqual(malformed, original);
});

test('shared validation preserves the graph and missing values without manufacturing CORE readiness', () => {
  const draft = pendingStudy('Synthetic', 'QUAL', '');
  draft.document.study!.versions = [{ id: 'draft-version', instanceType: 'StudyVersion' }];
  draft.execution.extensions = { nullable: null, zero: 0, disabled: false, ordered: ['b', 'a', 'b'] };
  const original = cloneStudy(draft);
  const validation = validateStudyDefinitionContent(draft, { mode: 'draft' });
  assert.equal(validation.draftValid, true);
  assert.equal(validation.structureValid, false);
  assert.equal(validation.conformanceValid, false);
  assert.equal(validation.releaseReady, false);
  assert.equal(validation.profile.ruleRelease, null);
  const read = readStudyWorkspace(response(workspace(draft)));
  assert.deepEqual(read.revision.content, original);
  assert.deepEqual(draft, original);
  assert.equal(Object.prototype.hasOwnProperty.call(read.revision.content.document.study!.versions![0], 'versionIdentifier'), false);
  assert.equal(read.revision.validation.releaseReady, false);
  const complete = validateStudyDefinitionContent(syntheticStudyDefinition('QUAL'), { mode: 'release' });
  assert.equal(complete.structureValid, true);
  assert.equal(complete.conformanceValid, false);
  assert.equal(complete.releaseReady, false);
  assert.ok(complete.issues.some(issue => issue.code === 'USDM_CORE_REPORT_REQUIRED'));
});
