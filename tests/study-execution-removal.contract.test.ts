import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneStudy, pendingStudy, type ExecutionChanges } from '../runners/study-definition-client';
import { queued, response, workspace } from './study-contract-fixtures';

type Collection = 'visits' | 'sites';
function fixture() {
  const before = workspace(pendingStudy('Owned removal fixture', 'REMOVAL-FIXTURE'));
  before.executionContext.visits = [
    { studyEventDefinitionId: 901, name: 'Target visit', ordinal: 1, type: 'scheduled', repeating: false, statusId: 1 },
    { studyEventDefinitionId: 903, name: 'Retained visit', ordinal: 2, type: 'scheduled', repeating: false, statusId: 1 },
  ];
  before.executionContext.sites = [
    { studyId: 902, name: 'Target site', uniqueIdentifier: 'TARGET-SITE', statusId: 1 },
    { studyId: 904, name: 'Retained site', uniqueIdentifier: 'RETAINED-SITE', statusId: 1 },
  ];
  const after = workspace(before.revision.content, 42, 2);
  after.executionContext.visits = cloneStudy(before.executionContext.visits);
  after.executionContext.sites = cloneStudy(before.executionContext.sites);
  return { before, after };
}
function removal(collection: Collection): ExecutionChanges {
  return collection === 'visits'
    ? { visits: { upsert: [], removeIds: [901] } }
    : { sites: { upsert: [], archiveIds: [902] } };
}
function corrupt<Row extends { statusId?: number | null }>(rows: Row[], kind: string) {
  if (kind === 'missing') rows.shift();
  if (kind === 'another-row') rows[1].statusId = 5;
  if (kind === 'duplicate') {
    rows[0].statusId = 5;
    rows.push(cloneStudy(rows[0]));
  }
}

for (const collection of ['visits', 'sites'] as const) {
  for (const corruption of ['unchanged', 'missing', 'another-row', 'duplicate']) {
    test(`${collection} removal rejects ${corruption} readback despite an acknowledged new revision`, async () => {
      const { before, after } = fixture();
      if (collection === 'visits') corrupt(after.executionContext.visits, corruption);
      else corrupt(after.executionContext.sites, corruption);
      const { client } = queued(response(after), response(after));
      await assert.rejects(client.editExecution(before, removal(collection), 'Review exact native removal'), /remov|archiv/i);
    });
  }
  test(`${collection} removal retains the exact removed native row and verifies its second read`, async () => {
    const { before, after } = fixture();
    Object.assign(after.executionContext[collection][0], { statusId: 5 });
    const { client, calls } = queued(response(after), response(after));
    const actual = await client.editExecution(before, removal(collection), 'Review exact native removal');
    assert.deepEqual(actual.executionContext[collection], after.executionContext[collection]);
    assert.equal(actual.executionContext[collection][1].statusId, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body, {
      ...removal(collection), baseRevisionToken: before.revision.revisionToken, reason: 'Review exact native removal',
    });
  });
  for (const phase of ['before', 'after'] as const) {
    test(`${collection} removal refuses an unloaded ${phase} collection`, async () => {
      const fixtures = fixture();
      Object.assign(fixtures.after.executionContext[collection][0], { statusId: 5 });
      fixtures[phase].executionContext.loaded[collection] = false;
      const { client, calls } = queued(response(fixtures.after), response(fixtures.after));
      await assert.rejects(client.editExecution(fixtures.before, removal(collection), 'Review exact native removal'), /unloaded/);
      assert.equal(calls.length, phase === 'before' ? 0 : 1);
    });
  }
  test(`${collection} removal does not treat an omitted unloaded collection as an empty replacement`, async () => {
    const { before, after } = fixture();
    const omitted = collection === 'visits' ? 'sites' : 'visits';
    before.executionContext.loaded[omitted] = false;
    after.executionContext.loaded[omitted] = false;
    before.executionContext[omitted] = [];
    after.executionContext[omitted] = [];
    Object.assign(after.executionContext[collection][0], { statusId: 5 });
    const { client, calls } = queued(response(after), response(after));
    await client.editExecution(before, removal(collection), 'Review exact native removal');
    assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, omitted), false);
  });
  test(`${collection} removal still fails if the subsequent native GET loses its target`, async () => {
    const { before, after } = fixture();
    Object.assign(after.executionContext[collection][0], { statusId: 5 });
    const readback = cloneStudy(after);
    readback.executionContext[collection].shift();
    const { client, calls } = queued(response(after), response(readback));
    await assert.rejects(client.editExecution(before, removal(collection), 'Review exact native removal'), /readback differs/);
    assert.equal(calls.length, 2);
  });
}
