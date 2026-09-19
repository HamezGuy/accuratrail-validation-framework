import { cloneStudy, studyActivationReviewHash, type StudyWorkspace, type StudyResponse, type StudyActivationSnapshot } from '../runners/study-definition-client';
import { syntheticStudyDefinition } from '../runners/qualification-fixture';
import { workspace } from './study-contract-fixtures';

/** These are transport-only responses, never fabricated CORE qualification. */
export function activationSnapshot(before: StudyWorkspace, released?: StudyWorkspace['revision']): StudyActivationSnapshot {
  const appliedRevision = cloneStudy(released ?? workspace(before.revision.content, before.summary.studyId, 2).revision);
  appliedRevision.state = 'released';
  appliedRevision.validation.releaseReady = true;
  appliedRevision.manifestHash = `sha256:${'a'.repeat(64)}`;
  const review: StudyActivationSnapshot = {
    workspace: cloneStudy(before), appliedRevision,
    bundle: {
      formatVersion: '2.0', profile: { id: 'edc-study-exchange/2', mode: 'release', modelVersion: '4.0.0' },
      exportedAt: '2026-09-09T00:00:00.000Z', exportedBy: 'synthetic-transport',
      definition: cloneStudy(appliedRevision.content),
      execution: {
        visits: [], visitFormAssignments: [],
        forms: { formatVersion: '1.0', exportedAt: '2026-09-09T00:00:00.000Z', exportedBy: 'synthetic-transport', forms: [] },
        extensions: {},
      },
      source: { artifacts: [], normalizations: [], valueLedger: [] }, extensions: {},
    },
    formMappings: [],
    executionWitness: {
      profile: 'edc-study-activation-review/1', studyId: before.summary.studyId,
      appliedDefinitionRevisionId: appliedRevision.revisionId,
      appliedApplicationId: before.executionContext.appliedApplicationId,
      appliedExecutionHash: `sha256:${'b'.repeat(64)}`, currentExecutionHash: `sha256:${'b'.repeat(64)}`,
      reviewHash: '', matchesApplied: true,
    },
  };
  review.executionWitness.reviewHash = studyActivationReviewHash(review);
  return review;
}
export const activationResponse = (data: StudyActivationSnapshot): StudyResponse => ({ status: 200, body: { success: true, data } });
export function appliedFixture() {
  const before = workspace(syntheticStudyDefinition('QUAL'), 42, 3);
  before.executionContext.appliedDefinitionRevisionId = workspace(before.revision.content, 42, 2).revision.revisionId;
  before.executionContext.appliedApplicationId = '00000000-0000-4000-8000-000000000777';
  before.executionContext.appliedExecutionConfiguration = cloneStudy(before.revision.content.execution);
  return before;
}
