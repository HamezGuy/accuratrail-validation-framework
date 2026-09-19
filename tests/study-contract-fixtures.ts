import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateStudyDefinitionContent } from '@accura-trial/shared-types/usdm/validation';
import { StudyDefinitionClient, cloneStudy, type StudyWorkspace, type StudyContent, type StudyResponse } from '../runners/study-definition-client';
export function workspace(content: StudyContent, studyId = 42, number = 1): StudyWorkspace {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const study = content.document.study;
  assert.equal(typeof study?.name, 'string', 'The in-memory fixture needs an authored study name');
  assert.ok(study && typeof study.name === 'string');
  const createdAt = '2026-09-09T00:00:00.000Z';
  return {
    summary: { studyId, parentStudyId: null, displayName: study.name,
      primaryIdentifier: content.execution.identification.nativeIdentifier, oid: `S_${studyId}`,
      entityStatus: { id: 4, label: 'pending' }, currentDefinitionRevisionId: id(number),
      definitionState: 'draft', designs: [], sponsorNames: [] },
    revision: { revisionId: id(number), revisionToken: id(number + 100),
      revisionNumber: number, previousRevisionId: number > 1 ? id(number - 1) : null,
      contentHash: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
      createdAt, createdBy: 1, reason: 'Synthetic in-memory contract fixture',
      content: cloneStudy(content), state: 'draft',
      validation: validateStudyDefinitionContent(content, { mode: 'draft' }) },
    executionContext: { identity: { studyId, parentStudyId: null, oid: `S_${studyId}`, ownerId: 1, dateCreated: createdAt },
      entityStatus: { id: 4, label: 'pending' }, nativeVersion: null, databaseLockDate: null, counts: {},
      appliedDefinitionRevisionId: null, appliedApplicationId: null, appliedExecutionConfiguration: null,
      loaded: { visits: true, sites: true, groups: true, tasks: true }, visits: [], sites: [], groups: [], tasks: [] },
  };
}
export const response = (value: StudyWorkspace, status = 200): StudyResponse => ({ status, body: { success: true, data: value } });
export function queued(...responses: StudyResponse[]) {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const client = new StudyDefinitionClient(async (method, path, body) => {
    calls.push({ method, path, ...(body === undefined ? {} : { body: JSON.parse(JSON.stringify(body)) }) });
    assert.ok(responses.length, 'Unexpected request: no real network is available in this test');
    return cloneStudy(responses.shift()!);
  });
  return { client, calls };
}
