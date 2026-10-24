import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ALL_OQ_SUITES, OQ_CASE_IDS } from '../config/oq-case-registry';
import { TA3_OQ_CASES } from '../config/ta3-oq-cases';
import {
  armGroupedContent, refusalCode, retainedDocumentProblems, runTa3Suites, ta3LedgerProblems, TA3_LEDGER_REQUIRED, TA3_OUTCOME, TA3_SUITE_ORDER,
} from '../runners/oq-ta3-runner';
import { loadTa3OqPlan, parseTa3OqPlan, TA3_OQ_PLAN_MEMBERS, TA3_OQ_PLAN_REQUIRED, type Ta3OqPlan } from '../runners/ta3-oq-plan';
import { configurationMismatches, type DeclaredFlags } from '../runners/target-configuration';
import { saveEvidence, type EvidenceResult } from '../runners/evidence-capture';
import { fakeClock, startFakeEdc, type FakeEdcOptions, type FakeUser } from './fixtures/ta3-fake-edc';
import { temporaryDirectory } from './generated-documents';
import { workspace } from './study-contract-fixtures';
import { syntheticStudyDefinition } from '../runners/qualification-fixture';
import { ta3PlanJson, TA3_TEST_ACCOUNTS } from './ta3-plan-fixture';

// The TA3 OQ suites 13 to 18 (spec P20 3.4 and 4.5) against an in-process fake
// EDC (tests/fixtures/ta3-fake-edc.ts) on a controlled clock, so the hour-long
// escalation wait takes no wall time. Synthetic accounts and data only.

const root = path.resolve(__dirname, '..');
const USERS: FakeUser[] = [
  { username: 'ta3-operator', password: 'synthetic-operator-secret', userId: 7, role: 'admin', unblinded: true },
  { username: 'ta3-reviewer', password: 'synthetic-reviewer-secret', userId: 8, role: 'investigator', unblinded: true },
  { username: 'ta3-third', password: 'synthetic-third-secret', userId: 9, role: 'investigator', unblinded: true },
  { username: 'ta3-blinded', password: 'synthetic-blinded-secret', userId: 10, role: 'data_manager', unblinded: false },
  { username: 'ta3-monitor', password: 'synthetic-monitor-secret', userId: 11, role: 'monitor', unblinded: false },
];
const ENV: Record<string, string> = Object.fromEntries(Object.values(TA3_TEST_ACCOUNTS).flatMap((key, index) => [
  [`TA3_TEST_${key}_USERNAME`, USERS[index].username], [`TA3_TEST_${key}_PASSWORD`, USERS[index].password]]));
const SECRETS = USERS.map(user => user.password);
const ALL = [13, 14, 15, 16, 17, 18];
const DECLARED: DeclaredFlags = { ENABLE_DEVIATION_ENGINE: true, ENABLE_DOMAIN_EVENTS: true, ENABLE_DEVIATION_DECISIONS: true,
  INSPECTION_COPY_TA3_INVENTORY: true, ENABLE_SEGMENTED_INSPECTION_EXPORT: true };
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const planJson = ta3PlanJson;
const plan = (overrides: Record<string, unknown> = {}): Ta3OqPlan => parseTa3OqPlan(planJson(overrides));

async function runAgainst(t: { after(callback: () => unknown): void }, edcOptions: Partial<FakeEdcOptions> = {},
  options: { selection?: number[]; declaredFlags?: DeclaredFlags | null; plan?: Ta3OqPlan } = {}) {
  const clock = fakeClock();
  const thePlan = options.plan ?? plan();
  const edc = await startFakeEdc({ plan: thePlan, users: USERS, clock, ...edcOptions });
  t.after(() => edc.close());
  const results = await runTa3Suites(edc.baseUrl, thePlan, options.selection ?? ALL, { env: ENV, clock, pollIntervalMs: 30_000,
    declaredFlags: options.declaredFlags === null ? undefined : options.declaredFlags ?? DECLARED });
  const row = (id: string): EvidenceResult => {
    const found = results.find(result => result.testCaseId === id);
    assert.ok(found, `${id} has a record`);
    return found;
  };
  return { results, edc, row };
}
/** [passed, not executed (CONTRACT), outcome code]. */
const outcome = (row: EvidenceResult) => [row.passed, row.method === 'CONTRACT', row.outcomeCode ?? null];
const idsOf = (first: number, last: number) => TA3_OQ_CASES.map(entry => entry.id).filter(id => Number(id.slice(3)) >= first && Number(id.slice(3)) <= last);

test('every TA3 suite passes against an EDC with O-1, O-2, M-2 and W-1, and OQ-243 waits for a user download route', async t => {
  const { results, edc, row } = await runAgainst(t);
  const cases = results.filter(result => /^OQ-\d{3}$/.test(result.testCaseId));
  assert.deepEqual(cases.map(result => result.testCaseId), TA3_OQ_CASES.map(entry => entry.id));
  for (const result of cases.filter(entry => entry.testCaseId !== 'OQ-243')) assert.equal(result.passed, true, `${result.testCaseId}: ${result.notes}`);
  assert.deepEqual(outcome(row('OQ-243')), [false, true, TA3_OUTCOME.SEGMENTED_READ_NOT_EXPOSED]);
  // Each suite logs its accounts in and out; suite 16, the longest wait, runs last.
  assert.deepEqual(results.filter(result => result.testCaseId.startsWith('OQ-TA3-SUITE-')).map(result => [result.testCaseId, result.passed]),
    TA3_SUITE_ORDER.map(suite => [`OQ-TA3-SUITE-${suite}`, true]));
  // The waits outlast the token and the idle timeout: every account logged in again before use, so no request met a 401.
  assert.equal(edc.unauthorized, 0);
  assert.ok((edc.logins.get('ta3-operator') ?? 0) > TA3_SUITE_ORDER.length, 'the operator logged in again after the hour-long wait');
  // Each case records its regulatory reference, description and acceptance criterion from the catalog.
  assert.match(row('OQ-207').regulatoryRef ?? '', /^§11\.10\(a\), §11\.10\(e\); ICH E6\(R3\) Annex 1, 3\.12 Noncompliance/);
  assert.equal(row('OQ-219').testDescription, 'Platform List Includes Site Deviations (needs: O-1)');
  // Owned records are listed with the case that made them, and no credential is retained.
  const owned = results.filter(result => result.testCaseId.startsWith('OQ-TA3-SUITE-')).flatMap(result => (result.responseBody as { owned: Array<{ kind: string; caseId: string }> }).owned);
  assert.ok(owned.some(entry => entry.kind === 'subject' && entry.caseId === 'OQ-207'));
  assert.ok(owned.some(entry => entry.kind === 'escalation-policy-proposal' && entry.caseId === 'OQ-227'));
  const text = JSON.stringify(results);
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, 'no password is retained');
  assert.doesNotMatch(text, /"accessToken":"[^[]/);
  // The records keep the evidence contract.
  saveEvidence(temporaryDirectory(t, 'accura-ta3-oq-'), 'oq', results);
});

test('the engine off fails suites 13 and 14 with ENGINE_DISABLED, and the declaration it contradicts is a CONFIGURATION_MISMATCH', async t => {
  const { results, row } = await runAgainst(t, { engine: false }, { selection: [13, 14], declaredFlags: { ENABLE_DEVIATION_ENGINE: true } });
  for (const id of idsOf(206, 218)) assert.deepEqual(outcome(row(id)), [false, false, TA3_OUTCOME.ENGINE_DISABLED], `${id}: ${row(id).notes}`);
  assert.match(row('OQ-206').notes, /CONFIGURATION_MISMATCH: ENABLE_DEVIATION_ENGINE is declared true but the target answered it off/);
  // The sealing cross-check reads the same records (runners/target-configuration.ts).
  assert.deepEqual(configurationMismatches({ ENABLE_DEVIATION_ENGINE: true }, { iq: [], oq: results }),
    [{ flag: 'ENABLE_DEVIATION_ENGINE', declared: true, observed: false, observedBy: 'OQ-206' }]);
});

test('O-1 switched off is FEATURE_DISABLED_AT_TARGET, O-1 absent is FEATURE_ABSENT_AT_RELEASE, and the ungated reads stay ungated', async t => {
  const disabled = await runAgainst(t, { o1: 'disabled' }, { selection: [13, 15] });
  for (const id of ['OQ-221', 'OQ-222', 'OQ-223', 'OQ-224', 'OQ-225']) {
    assert.deepEqual(outcome(disabled.row(id)), [false, false, TA3_OUTCOME.FEATURE_DISABLED_AT_TARGET], `${id}: ${disabled.row(id).notes}`);
  }
  assert.match(disabled.row('OQ-225').notes, /Review independence holds/);
  for (const id of ['OQ-219', 'OQ-220', 'OQ-226']) assert.equal(disabled.row(id).passed, true, `${id}: ${disabled.row(id).notes}`);
  assert.match(disabled.row('OQ-221').notes, /CONFIGURATION_MISMATCH: ENABLE_DEVIATION_DECISIONS is declared true but the target answered it off/);
  assert.deepEqual(configurationMismatches(DECLARED, { iq: [], oq: disabled.results }).map(entry => entry.observedBy), ['OQ-221', 'OQ-222', 'OQ-223', 'OQ-224']);

  const absent = await runAgainst(t, { o1: 'absent' }, { selection: [13, 15] });
  for (const id of idsOf(219, 225)) assert.deepEqual(outcome(absent.row(id)), [false, false, TA3_OUTCOME.FEATURE_ABSENT_AT_RELEASE], `${id}: ${absent.row(id).notes}`);
  assert.equal(absent.row('OQ-226').passed, true, absent.row('OQ-226').notes);
  // An absent feature is no contradiction of a declared flag.
  assert.deepEqual(configurationMismatches(DECLARED, { iq: [], oq: absent.results }), []);
});

test('a refusal is classified by status and code together; any other 404 or 400 is an ordinary failure', () => {
  const reply = (status: number, body: unknown) => ({ status, body });
  assert.equal(refusalCode(reply(503, { success: false, message: 'Set ENABLE_DEVIATION_ENGINE=true to enable it.' })), TA3_OUTCOME.ENGINE_DISABLED);
  assert.equal(refusalCode(reply(503, { success: false, message: 'Evaluations owed by recent saves are still running.' })), undefined);
  assert.equal(refusalCode(reply(503, { success: false, code: 'DEVIATION_DECISIONS_DISABLED' })), TA3_OUTCOME.FEATURE_DISABLED_AT_TARGET);
  assert.equal(refusalCode(reply(503, { success: false, code: 'SEGMENTED_INSPECTION_EXPORT_DISABLED' })), TA3_OUTCOME.FEATURE_DISABLED_AT_TARGET);
  assert.equal(refusalCode(reply(404, { success: false, message: 'Route POST /api/protocol-deviations/7/assessment not found' })), TA3_OUTCOME.FEATURE_ABSENT_AT_RELEASE);
  assert.equal(refusalCode(reply(404, { success: false, message: 'Deviation 7 not found' })), undefined, 'an unknown deviation id is an ordinary failure');
  const unknownMember = reply(400, { success: false, message: 'Validation failed', errors: [{ field: 'includeSites', type: 'object.unknown' }] });
  assert.equal(refusalCode(unknownMember, 'includeSites'), TA3_OUTCOME.FEATURE_ABSENT_AT_RELEASE);
  assert.equal(refusalCode(unknownMember), undefined, 'only the member a later item adds is classified');
  assert.equal(refusalCode(reply(400, { success: false, message: 'Supply a UUID requestKey and optional boolean includeTraining' }), 'profile'), TA3_OUTCOME.FEATURE_ABSENT_AT_RELEASE);
  assert.equal(refusalCode(reply(400, { success: false, message: 'Validation failed', errors: [{ field: 'reason', type: 'any.required' }] }), 'includeSites'), undefined);
});

test('suite 18 follows the declared inventory flags, the segmented export switch and the release', async t => {
  const declaredOff = await runAgainst(t, { ta3Inventory: false }, { selection: [18], declaredFlags: { ...DECLARED, INSPECTION_COPY_TA3_INVENTORY: false } });
  assert.deepEqual(outcome(declaredOff.row('OQ-241')), [false, false, TA3_OUTCOME.FEATURE_DISABLED_AT_TARGET]);
  assert.equal(declaredOff.row('OQ-242').passed, true, declaredOff.row('OQ-242').notes);
  assert.match(declaredOff.row('OQ-242').notes, /declared false, so the flat copy states no segmented-only limitation/);
  assert.deepEqual(outcome(declaredOff.row('OQ-240')), [false, true, TA3_OUTCOME.PREREQUISITE_MISSING], 'no owned deviation without suites 13 and 15');

  const contradicted = await runAgainst(t, {}, { selection: [18], declaredFlags: { ...DECLARED, INSPECTION_COPY_TA3_INVENTORY: false } });
  assert.deepEqual(outcome(contradicted.row('OQ-241')), [false, false, TA3_OUTCOME.CONFIGURATION_MISMATCH]);
  assert.deepEqual(configurationMismatches({ INSPECTION_COPY_TA3_INVENTORY: false }, { iq: [], oq: contradicted.results }),
    [{ flag: 'INSPECTION_COPY_TA3_INVENTORY', declared: false, observed: true, observedBy: 'OQ-241' }]);

  const switchedOff = await runAgainst(t, { w1: 'disabled' }, { selection: [18] });
  assert.equal(switchedOff.row('OQ-241').passed, true, switchedOff.row('OQ-241').notes);
  assert.deepEqual(outcome(switchedOff.row('OQ-242')), [false, false, TA3_OUTCOME.FEATURE_DISABLED_AT_TARGET]);
  assert.match(switchedOff.row('OQ-242').notes, /CONFIGURATION_MISMATCH: ENABLE_SEGMENTED_INSPECTION_EXPORT is declared true/);

  const head = await runAgainst(t, { w1: 'absent' }, { selection: [18] });
  assert.deepEqual(outcome(head.row('OQ-241')), [false, false, TA3_OUTCOME.FEATURE_ABSENT_AT_RELEASE]);
  assert.deepEqual(outcome(head.row('OQ-242')), [false, false, TA3_OUTCOME.FEATURE_ABSENT_AT_RELEASE]);
  assert.equal(head.row('OQ-239').passed, true, 'the flat copy exists at head');
  assert.equal(head.row('OQ-244').passed, true);
  assert.deepEqual(outcome(head.row('OQ-243')), [false, true, TA3_OUTCOME.SEGMENTED_READ_NOT_EXPOSED]);

  const undeclared = await runAgainst(t, {}, { selection: [18], declaredFlags: null });
  for (const id of ['OQ-241', 'OQ-242']) assert.deepEqual(outcome(undeclared.row(id)), [false, true, TA3_OUTCOME.NO_TARGET_CONFIGURATION]);
});

test('a training refusal of the first clinical write records the dependent cases not executed with TRAINING_NOT_CURRENT', async t => {
  const { row, edc } = await runAgainst(t, { trainingRefused: ['ta3-operator'] }, { selection: [13] });
  for (const id of ['OQ-207', 'OQ-208', 'OQ-209', 'OQ-210']) assert.deepEqual(outcome(row(id)), [false, true, TA3_OUTCOME.TRAINING_NOT_CURRENT], `${id}: ${row(id).notes}`);
  for (const id of ['OQ-206', 'OQ-211', 'OQ-212', 'OQ-213', 'OQ-214']) assert.deepEqual(outcome(row(id)), [false, true, TA3_OUTCOME.PREREQUISITE_MISSING], `${id}: ${row(id).notes}`);
  assert.match(row('OQ-206').notes, /The engine answers for study 100 with active spec/);
  // One refused enrollment; later clinical writes by the same account are not attempted.
  assert.equal(edc.calls.filter(call => call === 'POST /api/subjects').length, 1);
});

test('a token near its expiry logs in again before use, so no request meets a 401', async t => {
  const { results, edc } = await runAgainst(t, { tokenLifetimeMs: 140_000 }, { selection: [13] });
  for (const result of results.filter(entry => /^OQ-\d{3}$/.test(entry.testCaseId) && Number(entry.testCaseId.slice(3)) <= 214)) {
    assert.equal(result.passed, true, `${result.testCaseId}: ${result.notes}`);
  }
  assert.equal(edc.unauthorized, 0);
  assert.ok((edc.logins.get('ta3-operator') ?? 0) >= 2, 'the operator logged in again before its token expired');
});

test('the escalation window not waited and a recipient without the role are setup codes, never release failures', async t => {
  const unwaited = await runAgainst(t, {}, { selection: [16], plan: plan({ escalation: { recipientRole: 'investigator', recipientUsername: 'ta3-recipient' } }) });
  assert.equal(unwaited.row('OQ-227').passed, true, unwaited.row('OQ-227').notes);
  for (const id of ['OQ-228', 'OQ-229', 'OQ-230', 'OQ-231']) {
    assert.deepEqual(outcome(unwaited.row(id)), [false, true, TA3_OUTCOME.ESCALATION_WINDOW_NOT_WAITED], `${id}: ${unwaited.row(id).notes}`);
  }
  const unstaffed = await runAgainst(t, { recipientHoldsRole: false }, { selection: [16] });
  for (const id of ['OQ-228', 'OQ-230']) assert.deepEqual(outcome(unstaffed.row(id)), [false, true, TA3_OUTCOME.RECIPIENT_UNAVAILABLE], `${id}: ${unstaffed.row(id).notes}`);
  assert.deepEqual(outcome(unstaffed.row('OQ-229')), [false, true, TA3_OUTCOME.PREREQUISITE_MISSING]);
});

test('O-2 and M-2 absent at the release fail their cases with FEATURE_ABSENT_AT_RELEASE', async t => {
  const { row } = await runAgainst(t, { o2: 'absent', m2: false }, { selection: [16, 17] });
  for (const id of idsOf(227, 231)) assert.deepEqual(outcome(row(id)), [false, false, TA3_OUTCOME.FEATURE_ABSENT_AT_RELEASE], `${id}: ${row(id).notes}`);
  assert.deepEqual(outcome(row('OQ-237')), [false, false, TA3_OUTCOME.FEATURE_ABSENT_AT_RELEASE]);
  for (const id of ['OQ-232', 'OQ-233', 'OQ-234', 'OQ-235', 'OQ-236', 'OQ-238']) assert.equal(row(id).passed, true, `${id}: ${row(id).notes}`);
});

test('a blinded reader that receives arm-grouped content fails OQ-236', async t => {
  const { row } = await runAgainst(t, { blindedLeaksArms: true }, { selection: [17] });
  assert.deepEqual(outcome(row('OQ-236')), [false, false, null]);
  assert.match(row('OQ-236').notes, /A blinded reader received arm-level content: .*arm-grouped content at \$\.milestones\.derived\.armRecruitment\[0\]\.allocated/);
  assert.match(row('OQ-237').notes, /a blinded reader received arm-grouped content/);
});

test('without a plan every TA3 case records NO_TA3_PLAN and no request is made', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No TA3 request may be made without a plan'); });
  const results = await runTa3Suites('http://127.0.0.1:9', null, [13, 14]);
  assert.deepEqual(results.map(result => result.testCaseId), TA3_OQ_CASES.map(entry => entry.id));
  for (const result of results) {
    const suite = TA3_OQ_CASES.find(entry => entry.id === result.testCaseId)!.suite;
    assert.deepEqual(outcome(result), [false, true, suite <= 14 ? TA3_OUTCOME.NO_TA3_PLAN : TA3_OUTCOME.OQ_SUITE_NOT_SELECTED], result.testCaseId);
  }
});

test('an unselected suite records OQ_SUITE_NOT_SELECTED and opens no session', async t => {
  const { results, edc } = await runAgainst(t, {}, { selection: [17] });
  assert.deepEqual(results.filter(result => result.testCaseId.startsWith('OQ-TA3-SUITE-')).map(result => result.testCaseId), ['OQ-TA3-SUITE-17']);
  for (const result of results.filter(entry => /^OQ-\d{3}$/.test(entry.testCaseId) && !idsOf(232, 238).includes(entry.testCaseId))) {
    assert.deepEqual(outcome(result), [false, true, TA3_OUTCOME.OQ_SUITE_NOT_SELECTED], result.testCaseId);
  }
  assert.equal(edc.logins.get('ta3-monitor'), undefined, 'suite 17 does not act as the monitor');
});

test('the same person behind two plan accounts is refused before any request', async () => {
  await assert.rejects(runTa3Suites('http://127.0.0.1:9', plan(), ALL, { env: { ...ENV, TA3_TEST_THIRD_USERNAME: 'ta3-reviewer' } }),
    /reviewer and thirdPerson accounts are the same user/);
});

test('a ta3-oq-plan/1 is read strictly, holds no secret and its schema requires what the validator requires', t => {
  assert.throws(() => parseTa3OqPlan({ ...planJson(), inspection: { segmentedExpected: true } }), /has unknown member inspection/);
  assert.throws(() => parseTa3OqPlan(planJson({ synthetic: false })), /synthetic must be true/);
  const literal = planJson();
  (literal.accounts as any).reviewer.password = 'hunter2-literal';
  assert.throws(() => parseTa3OqPlan(literal), error => error instanceof Error && /accounts\.reviewer\.password must be the name of the environment variable/.test(error.message)
    && !error.message.includes('hunter2-literal'));
  const twice = planJson();
  (twice.accounts as any).thirdPerson.username = 'TA3_TEST_REV_USERNAME';
  assert.throws(() => parseTa3OqPlan(twice), /same username variable for two accounts/);
  const defaulted = planJson();
  delete (defaulted.accounts as any).operator;
  assert.equal(parseTa3OqPlan(defaulted).accounts.operator, undefined, 'the operator defaults to OQ_USERNAME and OQ_PASSWORD');
  assert.throws(() => parseTa3OqPlan(planJson({ applicability: { versions: [{ protocolVersion: 'v2', effectiveFrom: '2026-01-01' }, { protocolVersion: 'v1', effectiveFrom: '2025-01-01' }],
    versionedRuleId: 'R-1', earlyEnrollmentDate: '2025-06-01', lateEnrollmentDate: '2026-06-01' } })), /first taking effect before the second/);
  assert.throws(() => parseTa3OqPlan(planJson({ escalation: { recipientRole: 'admin', recipientUsername: 'x' } })), /recipientRole must be one of/);
  assert.throws(() => parseTa3OqPlan(planJson({ saveRule: { ...(planJson().saveRule as object), compliantValue: '999' } })), /same violating and compliant value/);
  assert.equal(parseTa3OqPlan(planJson({ followUpTask: null, applicability: null })).applicability, null);

  const file = path.join(temporaryDirectory(t, 'accura-ta3-plan-'), 'plan.json');
  fs.writeFileSync(file, `\uFEFF${JSON.stringify(planJson(), null, 2)}`);
  const loaded = loadTa3OqPlan(file);
  assert.equal(loaded.sha256, sha256(fs.readFileSync(file)));
  assert.equal(loaded.plan.study.siteStudyId, 101);
  assert.throws(() => loadTa3OqPlan(path.join(path.dirname(file), 'absent.json')), /cannot be read \(ENOENT\)/);

  const schema = JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'ta3-oq-plan-v1.schema.json'), 'utf8'));
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.title, 'ta3-oq-plan/1');
  assert.deepEqual(schema.required, [...TA3_OQ_PLAN_REQUIRED]);
  assert.deepEqual(Object.keys(schema.properties).sort(), [...TA3_OQ_PLAN_REQUIRED].sort());
  for (const [member, { required, optional }] of Object.entries(TA3_OQ_PLAN_MEMBERS)) {
    const definition = schema.definitions[member];
    assert.ok(definition, `the schema defines ${member}`);
    assert.equal(definition.additionalProperties, false, member);
    assert.deepEqual(definition.required ?? [], [...required], member);
    assert.deepEqual(Object.keys(definition.properties).sort(), [...required, ...optional].sort(), member);
  }
});

test('the retained K6b EDC bytes keep their SHA-256, pass the retained-document checks and are found arm-grouped', () => {
  const fixtures = path.join(__dirname, 'fixtures', 'edc-k6b');
  for (const [file, schemaVersion, digest] of [
    ['milestone-measurement.exact.json', 'edc-milestone-measurement/1', 'a73022c09f8250d7d5fa054ed4621e3610ba8bfd114a1c3897bee852333e2047'],
    ['effort-ledger.exact.json', 'edc-effort-ledger/1', 'd8e3b1901321b14734cfe898204fd6888d8740955c7be9861ac9b2f1005b9dbe'],
  ] as const) {
    const bytes = fs.readFileSync(path.join(fixtures, file));
    assert.equal(sha256(bytes), digest, `${file} is the retained byte copy (spec P20 F-h)`);
    assert.deepEqual(retainedDocumentProblems(bytes, { schemaVersion, sha256: [digest] }), [], file);
    assert.ok(retainedDocumentProblems(bytes, { schemaVersion, sha256: ['0'.repeat(64)] }).length > 0, `${file}: a different stated hash is found`);
    const document = JSON.parse(bytes.toString('utf8'));
    assert.equal(document.armGrouping, 'included');
    assert.ok(armGroupedContent(document).length > 0, `${file}: its unblinded content is detected, so a blinded reader holding it fails OQ-236`);
  }
  // A withheld document of the same shapes holds no arm-grouped content.
  const withheld = { armGrouping: 'withheld', milestones: { derived: { firstDosed: { platform: null, arms: 'withheld' }, armRecruitment: [{ armId: 1, targetReachedAt: 'withheld', status: 'withheld' }] } },
    intervals: [{ metric: 'arm-may-proceed-to-first-dosed', scope: { armId: 1 }, status: 'withheld' }, { metric: 'irb-per-arm', scope: { armId: 1 }, status: 'measured' }] };
  assert.deepEqual(armGroupedContent(withheld), []);
  assert.deepEqual(ta3LedgerProblems({ ...Object.fromEntries(TA3_LEDGER_REQUIRED.map(key => [key, null])), schemaVersion: 'edc-ta3-ledger/1',
    snapshot: { isolation: 'repeatable-read-read-only', single: true }, armGrouping: 'withheld' }, { blinded: true }), []);
  assert.match(ta3LedgerProblems({ schemaVersion: 'edc-ta3-ledger/1' }).join('; '), /it lacks studyId, date/);
});

test('the TA3 suites run after the base fixture cleanup and logout and before the login quota probe', async t => {
  const pq = require('../runners/pq-runner'), auth = require('../runners/auth'), oq = require('../runners/oq-runner');
  const baseUrl = 'https://qualification.invalid';
  const saved = { ...process.env };
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  Object.assign(process.env, ENV, { OQ_USERNAME: 'synthetic-oq-operator', OQ_PASSWORD: 'synthetic-oq-secret' });
  const calls: string[] = [];
  const evidence = { testCaseId: 'OQ-LOGIN', timestamp: new Date().toISOString(), endpoint: '/api/auth/login', method: 'POST', responseStatus: 200, responseBody: { success: true }, passed: true, notes: 'Offline session fixture' };
  const study = workspace(syntheticStudyDefinition('OQ-TA3-ORDER'));
  t.mock.method(auth, 'login', async (_url: string, _username: string, _password: string, testCaseId = 'OQ-LOGIN') => {
    calls.push(`LOGIN ${testCaseId}`);
    return { evidence: { ...evidence, testCaseId }, session: { token: 'owned-session', userId: 7, orgId: 8 } };
  });
  t.mock.method(pq, 'runStudySetup', async (_url: string, state: any) => { state.studyId = 42; state.studyWorkspace = study; return [{ ...evidence, testCaseId: 'PQ-001' }]; });
  t.mock.method(pq, 'runDataEntry', async () => { throw new Error('Offline unexpected suite failure'); });
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${new URL(url).pathname}`; calls.push(route);
    if (route === 'DELETE /api/studies/42') { study.executionContext.entityStatus = { id: 5, label: 'removed' }; return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } }); }
    if (route === 'GET /api/studies/42') return new Response(JSON.stringify({ success: true, data: study }), { headers: { 'Content-Type': 'application/json' } });
    if (route === 'POST /api/auth/logout') return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ success: false }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  });
  const directory = temporaryDirectory(t, 'accura-ta3-order-');
  const planFile = path.join(directory, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(planJson()));
  const results = await oq.run(directory, baseUrl, undefined, ['--synthetic-qualification', '--allow-production-qualification'], { ta3PlanFile: planFile, suites: ALL_OQ_SUITES });
  assert.equal(results.filter((result: any) => /^OQ-\d{3}$/.test(result.testCaseId)).length, OQ_CASE_IDS.length);
  const baseLogout = calls.indexOf('POST /api/auth/logout');
  const firstTa3Login = calls.findIndex(call => call.startsWith('LOGIN OQ-TA3-'));
  assert.ok(baseLogout >= 0 && firstTa3Login > baseLogout, 'the TA3 suites start after the base fixture cleanup and logout');
  assert.equal(calls.at(-1), 'POST /api/auth/login', 'the quota probe runs last');
  assert.ok(calls.lastIndexOf('POST /api/auth/logout') < calls.length - 1 && calls.lastIndexOf('POST /api/auth/logout') > firstTa3Login,
    'every TA3 session is logged out before the quota probe');
  assert.ok(results.some((result: any) => result.testCaseId === 'OQ-TA3-SUITE-16'));
});
