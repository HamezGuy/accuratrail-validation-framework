import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  ApplyStudyDefinitionCommand, CreateStudyDefinitionCommand, ReleaseStudyDefinitionCommand,
  ReplaceStudyDefinitionCommand, StudyDefinitionContent as StudyContent,
  StudyDefinitionSignature as StudySignature, StudyExecutionEditCommand,
  StudySummary, StudySummaryPage, StudyWorkspaceSnapshot as StudyWorkspace,
  StudyDefinitionRevision, StudyExchangeBundle,
} from '@accura-trial/shared-types';
import { validateStudyDefinitionContent } from '@accura-trial/shared-types/usdm/validation';
import { validateStudyExchange } from '@accura-trial/shared-types/study-exchange/validation';
import { ENTITY_STATUS } from '@accura-trial/shared-types';

/** The installed immutable package owns the wire graph and command types.
 * These aliases preserve the qualification clients' import names. This module
 * loads no config, credentials, state or HTTP and never projects the USDM graph. */
export type {
  StudyDefinitionContent as StudyContent, StudyDefinitionSignature as StudySignature,
  StudySummary, StudySummaryPage, StudyWorkspaceSnapshot as StudyWorkspace,
} from '@accura-trial/shared-types';
export type ExecutionChanges = Pick<StudyExecutionEditCommand, 'visits' | 'sites'>;

export interface StudyResponse { status: number; body: unknown }
export type StudyTransport = (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<StudyResponse>;
export interface StudyActivationReview {
  username: string;
  password: string;
  reason: string;
  acknowledgeUngoverned?: boolean;
  acknowledgeIncomplete?: boolean;
  /** When supplied by an operator, a newer review is never substituted. */
  activationReviewHash?: string;
}
/** Endpoint composition only; the installed package owns all clinical models. */
export interface StudyActivationSnapshot {
  workspace: StudyWorkspace;
  appliedRevision: StudyDefinitionRevision | null;
  bundle: StudyExchangeBundle;
  formMappings: Array<{
    refKey: string; crfId: number; crfVersionId: number;
    collection: 'forms' | 'externalForms'; sourceIndex: number;
  }>;
  executionWitness: {
    profile: 'edc-study-activation-review/1';
    studyId: number;
    appliedDefinitionRevisionId: string | null;
    appliedApplicationId: string | null;
    appliedExecutionHash: string | null;
    currentExecutionHash: string;
    reviewHash: string;
    matchesApplied: boolean;
  };
}
const record = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const nativeId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export const cloneStudy = <T>(value: T): T => structuredClone(value);
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);

/** The activation-review/1 transport digest uses sorted object keys, exact array
 * order and exact JSON values. Refuse unsupported values; never omit/truncate. */
function canonicalReviewJson(value: unknown, ancestors = new Set<object>(), depth = 0): string {
  check(depth <= 200, 'Activation review JSON exceeds the server canonicalization depth.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    check(Number.isFinite(value) && !Object.is(value, -0) && (!Number.isInteger(value) || Number.isSafeInteger(value)),
      'Activation review contains a number requiring exact source custody.');
    return JSON.stringify(value);
  }
  check(typeof value === 'object' && value !== null && !ancestors.has(value), 'Activation review is not finite JSON data.');
  const array = Array.isArray(value), descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors).filter(key => !(array && key === 'length'));
  check(keys.every(key => typeof key === 'string' && descriptors[key].enumerable && 'value' in descriptors[key]),
    'Activation review contains non-JSON properties.');
  const names = keys as string[];
  check(!array || (names.length === value.length && names.every((key, index) => key === String(index))),
    'Activation review contains a sparse or extended array.');
  ancestors.add(value);
  try {
    const parts = (array ? names : names.sort()).map(key => {
      const child = canonicalReviewJson(descriptors[key].value, ancestors, depth + 1);
      return array ? child : `${JSON.stringify(key)}:${child}`;
    });
    return array ? `[${parts.join(',')}]` : `{${parts.join(',')}}`;
  } finally { ancestors.delete(value); }
}

/** Matches the server's activation-review/1 binding, including form mappings and
 * every nested execution value. Generated export clocks and the archival source
 * envelope are report-only; the original bundle is returned unchanged. */
export function studyActivationReviewHash(review: StudyActivationSnapshot): string {
  const { reviewHash: _reviewHash, ...witness } = review.executionWitness;
  const { exportedAt: _exportedAt, exportedBy: _exportedBy, ...forms } = review.bundle.execution.forms;
  const configuration = {
    formatVersion: review.bundle.formatVersion, definition: review.bundle.definition,
    execution: { ...review.bundle.execution, forms }, extensions: review.bundle.extensions ?? {},
    sourceStudyName: review.bundle.sourceStudyName ?? null,
  };
  return `sha256:${createHash('sha256').update(canonicalReviewJson({
    ...witness, appliedManifestHash: review.appliedRevision?.manifestHash ?? null,
    configuration, formMappings: review.formMappings,
  })).digest('hex')}`;
}

/** Validate supplied draft values without mutating them or claiming CORE
 * conformance. Release readiness belongs to the exact server-reviewed revision. */
export function assertStudyContent(content: unknown): asserts content is StudyContent {
  const validation = validateStudyDefinitionContent(content, { mode: 'draft' });
  check(validation.draftValid, 'Study definition violates the pinned shared draft contract.');
}

/** Incomplete by design: authoring a draft does not assert release conformance. */
export function pendingStudy(name: string, nativeIdentifier: string, description?: string): StudyContent {
  return {
    contract: 'edc-study-definition/1', modelVersion: '4.0.0',
    document: { usdmVersion: '4.0.0', study: {
      id: randomUUID(), instanceType: 'Study', name,
      ...(description === undefined ? {} : { description }),
    } },
    selection: { versionId: null, designId: null },
    execution: {
      identification: { nativeIdentifier }, enrollment: { parameters: {} },
      facility: {}, monitoring: {}, notifications: {}, milestones: {}, extensions: {},
    },
    sourceArtifacts: [], entityBindings: [], dispositions: [], retainedValues: [],
  };
}

export function expectStudySuccess(response: StudyResponse, status: number): Record<string, any> {
  const body = response.body;
  // Report only controlled codes, never server source values or credentials.
  const applicationCode = record(body) ? body.code ?? body.error : undefined;
  const code = typeof applicationCode === 'string' && /^[A-Z][A-Z0-9_]+$/.test(applicationCode) ? ` (${applicationCode})` : '';
  check(response.status === status && record(body) && body.success === true,
    `Study request requires HTTP ${status} and success=true; received HTTP ${response.status}${code}.`);
  return body as Record<string, any>;
}

function assertSummary(summary: unknown): asserts summary is StudySummary {
  check(record(summary) && nativeId(summary.studyId) && typeof summary.displayName === 'string'
    && (summary.primaryIdentifier === null || typeof summary.primaryIdentifier === 'string')
    && (summary.oid === null || typeof summary.oid === 'string')
    && record(summary.entityStatus) && nativeId(summary.entityStatus.id), 'Invalid canonical study summary.');
}

export function readStudyWorkspace(response: StudyResponse, expectedStatus = 200, studyId?: number): StudyWorkspace {
  const workspace = expectStudySuccess(response, expectedStatus).data;
  check(record(workspace), 'Missing canonical study workspace.');
  assertSummary(workspace.summary);
  const revision = workspace.revision, context = workspace.executionContext;
  check(record(revision) && uuid(revision.revisionId) && uuid(revision.revisionToken)
    && nativeId(revision.revisionNumber) && ['draft', 'released'].includes(revision.state)
    && record(revision.validation) && revision.validation.draftValid === true
    && typeof revision.validation.releaseReady === 'boolean', 'Missing or invalid study revision.');
  const content = revision.content;
  assertStudyContent(content);
  check(record(content.document.study)
    && uuid(content.document.study.id) && content.document.study.instanceType === 'Study'
    && typeof content.document.study.name === 'string',
  'Missing or unsupported study definition content.');
  check(record(context) && context.identity?.studyId === workspace.summary.studyId
    && context.entityStatus?.id === workspace.summary.entityStatus.id
    && record(context.loaded) && ['visits', 'sites', 'groups', 'tasks'].every(key =>
      Array.isArray(context[key]) && typeof context.loaded[key] === 'boolean'),
  'Missing or mismatched native execution context.');
  check(studyId === undefined || workspace.summary.studyId === studyId, 'Study response belongs to a different native study.');
  check(workspace.summary.currentDefinitionRevisionId === revision.revisionId
    && workspace.summary.displayName === content.document.study.name
    && workspace.summary.primaryIdentifier === content.execution.identification.nativeIdentifier,
  'Study summary does not identify its canonical revision.');
  return workspace as StudyWorkspace;
}

export function readStudySummaryPage(response: StudyResponse): StudySummaryPage {
  const page = expectStudySuccess(response, 200).data;
  check(record(page) && Array.isArray(page.studies) && Number.isSafeInteger(page.total) && page.total >= 0
    && nativeId(page.page) && nativeId(page.pageSize) && page.studies.length <= page.pageSize
    && page.studies.length <= page.total, 'Missing canonical study summary page.');
  page.studies.forEach(assertSummary);
  check(new Set(page.studies.map((study: StudySummary) => study.studyId)).size === page.studies.length,
    'Study summary page contains duplicate native IDs.');
  return page as StudySummaryPage;
}

export function assertStudyReadback(actual: StudyWorkspace, expected: StudyWorkspace): void {
  check(actual.summary.studyId === expected.summary.studyId
    && actual.revision.revisionId === expected.revision.revisionId
    && actual.revision.revisionToken === expected.revision.revisionToken
    && actual.revision.state === expected.revision.state
    && isDeepStrictEqual(actual.revision.content, expected.revision.content),
  'Study readback differs from the acknowledged revision; reload and review before continuing.');
  for (const key of ['visits', 'sites', 'groups', 'tasks'] as const) {
    check(actual.executionContext.loaded[key] === expected.executionContext.loaded[key]
      && isDeepStrictEqual(actual.executionContext[key], expected.executionContext[key]),
    `Study ${key} readback differs from the acknowledged execution configuration.`);
  }
  check(actual.executionContext.appliedDefinitionRevisionId === expected.executionContext.appliedDefinitionRevisionId
    && actual.executionContext.appliedApplicationId === expected.executionContext.appliedApplicationId
    && isDeepStrictEqual(actual.executionContext.appliedExecutionConfiguration, expected.executionContext.appliedExecutionConfiguration),
  'Study application readback differs from the acknowledged application.');
}

export function readStudyActivationSnapshot(response: StudyResponse, expected: StudyWorkspace): StudyActivationSnapshot {
  const value = expectStudySuccess(response, 200).data;
  check(record(value), 'Missing authoritative activation review.');
  const workspace = readStudyWorkspace({ status: 200, body: { success: true, data: value.workspace } }, 200, expected.summary.studyId);
  assertStudyReadback(workspace, expected);
  check(isDeepStrictEqual(workspace.executionContext.identity, expected.executionContext.identity)
    && workspace.summary.oid === expected.summary.oid && workspace.summary.parentStudyId === expected.summary.parentStudyId
    && workspace.summary.entityStatus.id === expected.summary.entityStatus.id
    && Object.values(workspace.executionContext.loaded).every(loaded => loaded === true),
  'Activation review native identity/state differs from the acknowledged workspace.');
  const applied = value.appliedRevision, witness = value.executionWitness;
  check(record(applied) && uuid(applied.revisionId) && uuid(applied.revisionToken)
    && applied.revisionId === expected.executionContext.appliedDefinitionRevisionId
    && applied.state === 'released' && applied.validation?.draftValid === true && applied.validation?.releaseReady === true
    && sha256(applied.manifestHash), 'Release and apply the exact definition with verified execution evidence before activation.');
  assertStudyContent(applied.content);
  check(isDeepStrictEqual(applied.content, expected.revision.content)
    && isDeepStrictEqual(applied.content.execution, expected.executionContext.appliedExecutionConfiguration),
  'Current definition differs from the applied release; review, release and apply it before activation.');
  check(record(witness) && witness.profile === 'edc-study-activation-review/1'
    && witness.studyId === expected.summary.studyId
    && witness.appliedDefinitionRevisionId === applied.revisionId
    && uuid(witness.appliedApplicationId) && witness.appliedApplicationId === expected.executionContext.appliedApplicationId
    && sha256(witness.appliedExecutionHash) && sha256(witness.currentExecutionHash) && sha256(witness.reviewHash),
  'Activation review has missing or mismatched native identity, application or execution hashes.');
  check(witness.matchesApplied === true && witness.appliedExecutionHash === witness.currentExecutionHash,
    'Native execution differs from the applied release; review, release and apply it before activation.');
  const validated = validateStudyExchange(value.bundle);
  check(validated.valid, 'Activation review requires the complete canonical V2 exchange contract.');
  check(isDeepStrictEqual(validated.value.definition, applied.content),
    'Displayed activation definition differs from the exact applied release.');
  check(Array.isArray(value.formMappings), 'Activation review is missing exact native form mappings.');
  const pointers = new Set<string>(), nativeForms = new Set<number>();
  for (const mapping of value.formMappings) {
    check(record(mapping) && ['forms', 'externalForms'].includes(mapping.collection)
      && Number.isSafeInteger(mapping.sourceIndex) && mapping.sourceIndex >= 0
      && typeof mapping.refKey === 'string' && nativeId(mapping.crfId) && nativeId(mapping.crfVersionId),
    'Activation review has an invalid native form mapping.');
    const collection = mapping.collection === 'forms' ? validated.value.execution.forms.forms : validated.value.execution.externalForms ?? [];
    const pointer = `${mapping.collection}/${mapping.sourceIndex}`;
    check(collection[mapping.sourceIndex]?.refKey === mapping.refKey && !pointers.has(pointer) && !nativeForms.has(mapping.crfId),
      'Activation review form identities are missing, repeated or bound to another source form.');
    pointers.add(pointer); nativeForms.add(mapping.crfId);
  }
  check(pointers.size === validated.value.execution.forms.forms.length + (validated.value.execution.externalForms?.length ?? 0),
    'Activation review does not map every displayed form to an exact native version.');
  const review = value as StudyActivationSnapshot;
  check(studyActivationReviewHash(review) === witness.reviewHash, 'Activation review hash does not bind the displayed definition, execution and mappings.');
  return review;
}

/** Match only records introduced by this command, then verify every supplied
 * value. IDs returned by EDC remain numeric; USDM IDs never substitute for them. */
export function assertExecutionReadback(before: StudyWorkspace, after: StudyWorkspace, changes: ExecutionChanges): void {
  for (const collection of ['visits', 'sites'] as const) {
    const operation = changes[collection];
    if (!operation) continue;
    check(before.executionContext.loaded[collection] && after.executionContext.loaded[collection],
      `Cannot verify unloaded study ${collection}.`);
  }
  if (changes.visits) {
    verifyRows('visits', before.executionContext.visits, after.executionContext.visits,
      changes.visits.upsert, row => row.studyEventDefinitionId, row => row.ordinal);
    verifyRemovedRows('visits', before.executionContext.visits, after.executionContext.visits,
      changes.visits.removeIds, row => row.studyEventDefinitionId);
  }
  if (changes.sites) {
    verifyRows('sites', before.executionContext.sites, after.executionContext.sites,
      changes.sites.upsert, row => row.studyId, row => row.uniqueIdentifier);
    verifyRemovedRows('sites', before.executionContext.sites, after.executionContext.sites,
      changes.sites.archiveIds, row => row.studyId);
  }
}

/** Canonical workspace reads retain removed native rows. Absence cannot prove
 * an archive, and changing a different native row cannot satisfy the command. */
function verifyRemovedRows<Row extends { readonly statusId?: number | null }>(
  collection: 'visits' | 'sites', before: readonly Row[], after: readonly Row[],
  requestedIds: readonly number[], id: (row: Row) => number | undefined,
): void {
  check(Array.isArray(requestedIds) && requestedIds.every(nativeId) && new Set(requestedIds).size === requestedIds.length,
    `Study ${collection} removals require unique positive native IDs.`);
  for (const requestedId of requestedIds) {
    const prior = before.filter(row => id(row) === requestedId);
    const current = after.filter(row => id(row) === requestedId);
    check(prior.length === 1 && current.length === 1,
      `Missing or ambiguous native ${collection} removal readback.`);
    check(current[0].statusId === ENTITY_STATUS.REMOVED,
      `Study ${collection} removal or archive was not preserved.`);
  }
}

function verifyRows<Row extends object>(
  collection: 'visits' | 'sites', before: Row[], after: Row[], requestedRows: Row[],
  id: (row: Row) => number | undefined, match: (row: Row) => unknown,
): void {
  const previousIds = new Set(before.map(id)), matched = new Set<number>();
  for (const requested of requestedRows) {
    const candidates = after.filter(row => id(requested) === undefined
      ? !previousIds.has(id(row)) && match(row) === match(requested) : id(row) === id(requested));
    const message = `Missing or ambiguous native ${collection} ID in study execution readback.`;
    check(candidates.length === 1, message);
    const actual = candidates[0], actualId = id(actual);
    check(nativeId(actualId) && !matched.has(actualId), message);
    matched.add(actualId);
    for (const [key, value] of Object.entries(requested)) {
      const actualValue: unknown = Reflect.get(actual, key);
      if (key === 'crfAssignments') {
        check(Array.isArray(value) && Array.isArray(actualValue), 'Missing CRF assignment readback.');
        for (const assignment of value) {
          check(record(assignment), 'Invalid requested CRF assignment.');
          const assigned = actualValue.filter(row => record(row) && row.crfId === assignment.crfId);
          check(assigned.length === 1, 'Missing or ambiguous assigned native CRF.');
          for (const [field, expected] of Object.entries(assignment)) {
            check(isDeepStrictEqual(assigned[0][field], expected), `CRF assignment ${field} was not preserved.`);
          }
        }
      } else {
        check(isDeepStrictEqual(actualValue, value), `Study ${collection} ${key} was not preserved.`);
      }
    }
  }
}

export function assertEnrollmentReady(workspace: StudyWorkspace): void {
  check(uuid(workspace.executionContext.appliedApplicationId) && uuid(workspace.executionContext.appliedDefinitionRevisionId)
    && workspace.executionContext.appliedExecutionConfiguration !== null,
  'Study has no verified signed definition application; enrollment setup is incomplete.');
  check(workspace.executionContext.entityStatus.id === 1,
    'Study is not available for enrollment; complete the supported reviewed lifecycle workflow first.');
  check(workspace.executionContext.sites.every(site => site.statusId === 1),
    'A fixture site is not available for enrollment; setup is incomplete.');
}

export class StudyDefinitionClient {
  constructor(private readonly transport: StudyTransport) {}

  async get(studyId: number): Promise<StudyWorkspace> {
    check(nativeId(studyId), 'A positive native study ID is required.');
    return readStudyWorkspace(await this.transport('GET', `/studies/${studyId}`), 200, studyId);
  }

  async verify(expected: StudyWorkspace): Promise<StudyWorkspace> {
    const actual = await this.get(expected.summary.studyId);
    assertStudyReadback(actual, expected);
    return actual;
  }

  async create(content: StudyContent, reason: string): Promise<StudyWorkspace> {
    assertStudyContent(content);
    const expected = cloneStudy(content);
    const created = readStudyWorkspace(await this.transport('POST', '/studies', {
      content: expected, reason,
    } satisfies CreateStudyDefinitionCommand), 201);
    check(created.revision.state === 'draft' && isDeepStrictEqual(created.revision.content, expected),
      'Created study did not preserve the complete requested draft.');
    return this.verify(created);
  }

  async replace(before: StudyWorkspace, content: StudyContent, reason: string): Promise<StudyWorkspace> {
    assertStudyContent(content);
    const expected = cloneStudy(content);
    const after = readStudyWorkspace(await this.transport('PUT', `/studies/${before.summary.studyId}`, {
      baseRevisionToken: before.revision.revisionToken, content: expected, reason,
    } satisfies ReplaceStudyDefinitionCommand), 200, before.summary.studyId);
    this.assertNewRevision(before, after);
    check(after.revision.state === 'draft' && isDeepStrictEqual(after.revision.content, expected),
      'Study replacement did not preserve the complete requested draft.');
    check(after.executionContext.appliedApplicationId === before.executionContext.appliedApplicationId
      && after.executionContext.appliedDefinitionRevisionId === before.executionContext.appliedDefinitionRevisionId
      && isDeepStrictEqual(after.executionContext.appliedExecutionConfiguration, before.executionContext.appliedExecutionConfiguration),
    'Saving a draft unexpectedly changed the applied study definition.');
    return this.verify(after);
  }

  async editExecution(before: StudyWorkspace, changes: ExecutionChanges, reason: string): Promise<StudyWorkspace> {
    for (const key of ['visits', 'sites'] as const) {
      if (changes[key]) check(before.executionContext.loaded[key], `Cannot edit unloaded study ${key}.`);
    }
    const after = readStudyWorkspace(await this.transport('PUT', `/studies/${before.summary.studyId}/execution`, {
      ...cloneStudy(changes), baseRevisionToken: before.revision.revisionToken, reason,
    } satisfies StudyExecutionEditCommand), 200, before.summary.studyId);
    this.assertNewRevision(before, after);
    check(isDeepStrictEqual(after.revision.content, before.revision.content), 'Execution edit changed the canonical study document.');
    assertExecutionReadback(before, after, changes);
    return this.verify(after);
  }

  async releaseAndApply(before: StudyWorkspace, signature: StudySignature, reason: string): Promise<StudyWorkspace> {
    check(signature.password.length > 0 && signature.meaning.trim().length > 0, 'A reviewed release/application signature is required.');
    const released = readStudyWorkspace(await this.transport('POST', `/studies/${before.summary.studyId}/definition/release`, {
      baseRevisionToken: before.revision.revisionToken, reason, signature,
    } satisfies ReleaseStudyDefinitionCommand), 200, before.summary.studyId);
    this.assertNewRevision(before, released);
    check(released.revision.state === 'released' && released.revision.validation.releaseReady === true
      && isDeepStrictEqual(released.revision.content, before.revision.content), 'Server did not approve the exact released study definition.');
    await this.verify(released);
    const applied = readStudyWorkspace(await this.transport('POST', `/studies/${before.summary.studyId}/definition/apply`, {
      baseRevisionToken: released.revision.revisionToken, releasedRevisionId: released.revision.revisionId, reason, signature,
      applicability: { scope: 'new-enrolments', siteScope: 'study-and-inheriting-sites', existingSubjects: 'retain-current', effective: 'immediate' },
    } satisfies ApplyStudyDefinitionCommand), 200, before.summary.studyId);
    this.assertNewRevision(released, applied);
    check(applied.executionContext.appliedDefinitionRevisionId === released.revision.revisionId
      && uuid(applied.executionContext.appliedApplicationId)
      && isDeepStrictEqual(applied.executionContext.appliedExecutionConfiguration, released.revision.content.execution),
    'Server did not confirm application of the exact released revision.');
    return this.verify(applied);
  }

  async getActivationReview(before: StudyWorkspace): Promise<StudyActivationSnapshot> {
    check(uuid(before.executionContext.appliedDefinitionRevisionId) && uuid(before.executionContext.appliedApplicationId),
      'Release and apply the exact definition before activation.');
    return readStudyActivationSnapshot(await this.transport('GET', `/studies/${before.summary.studyId}/activation-review`), before);
  }

  /** `before` is the reviewed current workspace head, which may follow the
   * applied release. Its executionContext names the exact applied release ID.
   * Pass the operator's executionWitness.reviewHash as activationReviewHash to
   * pin a prior authoritative review; a different fresh review is rejected. */
  async activateReviewed(before: StudyWorkspace, review: StudyActivationReview): Promise<StudyWorkspace> {
    check(uuid(before.executionContext.appliedDefinitionRevisionId), 'Release and apply the exact definition before activation.');
    check(review.username.trim().length > 0 && review.password.length > 0 && review.reason.trim().length >= 5,
      'Human signature credentials and an activation reason are required.');
    const snapshot = await this.getActivationReview(before);
    check(review.activationReviewHash === undefined || (sha256(review.activationReviewHash)
      && review.activationReviewHash === snapshot.executionWitness.reviewHash),
    'The explicitly reviewed activation hash changed; review it again before signing.');
    expectStudySuccess(await this.transport('POST', `/forms/import-study-bundle/${before.summary.studyId}/activate`, {
      signatureUsername: review.username, signaturePassword: review.password,
      appliedDefinitionRevisionId: before.executionContext.appliedDefinitionRevisionId,
      activationReviewHash: snapshot.executionWitness.reviewHash,
      reason: review.reason,
      ...(review.acknowledgeUngoverned === undefined ? {} : { acknowledgeUngoverned: review.acknowledgeUngoverned }),
      ...(review.acknowledgeIncomplete === undefined ? {} : { acknowledgeIncomplete: review.acknowledgeIncomplete }),
    }), 200);
    const after = await this.get(before.summary.studyId);
    check(isDeepStrictEqual(after.revision.content, before.revision.content)
      && after.executionContext.appliedApplicationId === before.executionContext.appliedApplicationId
      && after.executionContext.appliedDefinitionRevisionId === before.executionContext.appliedDefinitionRevisionId
      && isDeepStrictEqual(after.executionContext.appliedExecutionConfiguration, before.executionContext.appliedExecutionConfiguration),
    'Activation readback changed the reviewed canonical definition or application.');
    assertEnrollmentReady(after);
    return after;
  }

  async findInSummaries(expected: StudyWorkspace): Promise<StudySummary> {
    const search = encodeURIComponent(expected.summary.primaryIdentifier ?? expected.summary.displayName);
    let pageNumber = 1, seen = new Set<number>();
    for (;;) {
      const page = readStudySummaryPage(await this.transport('GET', `/studies?page=${pageNumber}&limit=100&search=${search}`));
      check(page.page === pageNumber, 'Study pagination did not advance.');
      for (const study of page.studies) {
        check(!seen.has(study.studyId), 'Study pagination repeated a native study ID.');
        seen.add(study.studyId);
        if (study.studyId === expected.summary.studyId) {
          check(study.currentDefinitionRevisionId === expected.revision.revisionId
            && study.displayName === expected.summary.displayName && study.primaryIdentifier === expected.summary.primaryIdentifier,
          'Listed study does not match the acknowledged canonical revision.');
          return study;
        }
      }
      if (pageNumber * page.pageSize >= page.total || page.studies.length === 0) break;
      pageNumber++;
    }
    throw new Error('Created native study ID was not found in the canonical summary pages.');
  }

  private assertNewRevision(before: StudyWorkspace, after: StudyWorkspace): void {
    check(after.revision.revisionToken !== before.revision.revisionToken
      && after.revision.revisionId !== before.revision.revisionId
      && after.revision.previousRevisionId === before.revision.revisionId
      && after.revision.revisionNumber === before.revision.revisionNumber + 1,
    'Study command did not return the next revision based on the reviewed token.');
  }
}
