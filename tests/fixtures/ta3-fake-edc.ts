import * as http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Ta3OqPlan } from '../../runners/ta3-oq-plan';
import { TA3_INSPECTION_COVERAGE, W1_SEGMENTED_LIMITATION } from '../../config/ta3-inspection-coverage';
import { EDC_SIGNATURE_MEANINGS, TA3_LEDGER_REQUIRED } from '../../runners/oq-ta3-runner';

// An in-process stand-in for the EDC routes the TA3 OQ suites call (libreclinicaapi
// src/routes), for the contract tests only. It answers with the shapes and the
// refusals the runner reads: the engine's 503 naming ENABLE_DEVIATION_ENGINE, the
// O-1, O-2 and W-1 503 codes, the error handler's `Route <METHOD> <path> not
// found`, Joi's unknown-member 400 and the flat inspection route's own refusal.
// O-2 and M-2 are not built yet: their shapes follow specs P09 5.2 and P01 3.2.
// Synthetic data only; nothing here is a real study.

export interface FakeUser { username: string; password: string; userId: number; role: 'admin' | 'data_manager' | 'investigator' | 'monitor'; unblinded: boolean }

export interface FakeEdcOptions {
  plan: Ta3OqPlan;
  users: FakeUser[];
  clock: FakeClock;
  engine?: boolean;
  o1?: 'present' | 'disabled' | 'absent';
  o2?: 'present' | 'disabled' | 'absent';
  /** An older O-2 whose policy workspace states no decisionsEnabled, so off shows only as the command's 503. */
  workspaceOmitsDecisionsEnabled?: boolean;
  m2?: boolean;
  w1?: 'present' | 'disabled' | 'absent';
  /** The target's INSPECTION_COPY_TA3_INVENTORY. */
  ta3Inventory?: boolean;
  domainEvents?: boolean;
  /** Usernames whose clinical writes the training gate refuses. */
  trainingRefused?: string[];
  tokenLifetimeMs?: number;
  /** A defect: documents recorded by a blinded reader still carry arm content. */
  blindedLeaksArms?: boolean;
  /** The recipient holds the escalation role at the OQ site, and the fake escalates only then. */
  recipientHoldsRole?: boolean;
  /** The recipient holds the role in the parent study's staff list; with recipientHoldsRole false this models an
   * escalation stage that ignores a parent holder, which O-2 must not (it resolves holders at the site or its parent). */
  recipientAtParent?: boolean;
  /** The recipient's user id in the staff lists; the escalation names it among recipientUserIds. */
  recipientUserId?: number;
  /** A defect: the recipientUserIds an escalation names, whoever holds the role. */
  escalationRecipientUserIds?: number[];
  /** A defect: the recipientRole an escalation names. */
  escalationRecipientRole?: string;
  /** With nobody holding the role at the site or its parent, O-2 holds the level as RECIPIENT_UNAVAILABLE (escalationAttempts). */
  heldAttempts?: boolean;
  /** The status the OQ site's staff list answers (200 by default). */
  siteStaffStatus?: number;
  /** The platform study's own staff (the policy deciders, and the recipient when recipientAtParent). By default every user
   * whose role is investigator or data manager as that role, and an admin user as study_director (a data manager alias). */
  platformStaff?: Array<{ username: string; role: string; userId?: number }>;
  /** The plan's established versions are recorded at the platform study, so the OQ site has no applicability record of its own. */
  applicabilityAtParent?: boolean;
  /** Usernames whose signed requests are refused as the Part 11 middleware refuses wrong credentials: 401 with no code. */
  signatureRefused?: string[];
  /** The first session of this username is revoked at the EDC: its second request answers 401 SESSION_REVOKED. */
  revokeFirstSessionOf?: string;
}

export interface FakeClock { now(): number; sleep(ms: number): Promise<void>; onTick(listener: () => void): void }

export function fakeClock(start = Date.parse('2026-10-24T08:00:00.000Z')): FakeClock {
  let now = start;
  const listeners: Array<() => void> = [];
  return {
    now: () => now,
    sleep: async ms => { now += ms; for (const listener of listeners) listener(); },
    onTick: listener => { listeners.push(listener); },
  };
}

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const token = (userId: number, exp: number) =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ userId, exp: Math.floor(exp / 1000), sid: randomUUID() })).toString('base64url')}.fake`;

export interface FakeEdc {
  baseUrl: string;
  calls: string[];
  unauthorized: number;
  logins: Map<string, number>;
  close(): Promise<void>;
  state: any;
}

export async function startFakeEdc(options: FakeEdcOptions): Promise<FakeEdc> {
  const { plan, clock } = options;
  const o1 = options.o1 ?? 'present', o2 = options.o2 ?? 'present', w1 = options.w1 ?? 'present';
  const engine = options.engine ?? true, m2 = options.m2 ?? true, ta3Inventory = options.ta3Inventory ?? true;
  const lifetime = options.tokenLifetimeMs ?? 60 * 60_000;
  const root = plan.study.studyId, site = plan.study.siteStudyId;
  const users = new Map(options.users.map(user => [user.username, user]));
  const byId = new Map(options.users.map(user => [user.userId, user]));
  const recipientUserId = options.recipientUserId ?? 12;
  const recipientEntry = { userId: recipientUserId, username: plan.escalation.recipientUsername, role: plan.escalation.recipientRole };
  const platformStaff = options.platformStaff ?? options.users.filter(user => user.role !== 'monitor')
    .map(user => ({ userId: user.userId, username: user.username, role: user.role === 'admin' ? 'study_director' : user.role }));
  let revokedOnce = false, requestsBeforeRevocation = 0;
  let nextId = 1000;
  const id = () => ++nextId;
  const state = {
    tokens: new Map<string, { userId: number; exp: number; lastUsed: number; revoked: boolean }>(),
    subjects: new Map<number, { id: number; studyId: number; enrollmentDate: string; visits: number[]; value?: string; visitDate?: string }>(),
    forms: new Map<number, { subjectId: number; visitId: number }>(),
    receipts: new Map<number, any[]>(),
    deviations: new Map<number, any>(),
    events: new Map<number, any[]>(),
    applicability: [] as any[],
    tasks: [] as any[],
    followUps: new Set<number>(),
    policy: { revision: 0, proposals: [] as any[], inForce: null as any },
    milestones: { revision: 0, records: [] as any[] },
    attempts: new Map<number, any[]>(),
    uploads: new Set<string>(),
    documents: new Map<string, any[]>(),
    packages: [] as any[],
  };
  const calls: string[] = [];
  const logins = new Map<string, number>();
  let unauthorized = 0;

  // The plan's two established versions are recorded at the OQ site by VAL-1/validation-run step 0.
  for (const version of plan.applicability?.versions ?? []) {
    state.applicability.push({ applicabilityId: id(), studyId: options.applicabilityAtParent ? root : site, protocolVersion: version.protocolVersion, status: 'established',
      effectiveFrom: version.effectiveFrom, ethicsApprovalDate: null, documentedOn: null, basis: 'step 0', recordedBy: 1, recordedAt: new Date(clock.now()).toISOString() });
  }

  const currentRecords = () => {
    const newest = new Map<string, any>();
    for (const record of state.applicability.filter(entry => entry.studyId === site && (entry.documentedOn === null || entry.documentedOn <= day(clock.now())))) {
      const held = newest.get(record.protocolVersion);
      if (!held || record.applicabilityId > held.applicabilityId) newest.set(record.protocolVersion, record);
    }
    return [...newest.values()].filter(record => record.status !== 'withdrawn');
  };
  const applicabilityFor = (subject: { enrollmentDate: string }) => {
    const known = currentRecords();
    if (!known.length) return undefined;
    const target = day(Date.parse(`${subject.enrollmentDate}T00:00:00Z`) + 10 * 86_400_000);
    const established = known.filter(record => record.status === 'established' && record.effectiveFrom <= target).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    const governing = established.at(-1);
    const unresolved = known.filter(record => record.status === 'unresolved' && record.protocolVersion !== governing?.protocolVersion);
    if (unresolved.length) {
      return { visit_key: 'V2', target_date: target, protocol_version: null, version_status: 'unresolved', reason: 'activation_unresolved',
        candidate_versions: [...(governing ? [governing.protocolVersion] : []), ...unresolved.map(record => record.protocolVersion)] };
    }
    return governing ? { visit_key: 'V2', target_date: target, protocol_version: governing.protocolVersion, version_status: 'effective' }
      : { visit_key: 'V2', target_date: target, protocol_version: null, version_status: 'unresolved', reason: 'no_version_effective', candidate_versions: [] };
  };

  const logDeviation = (row: Record<string, unknown>) => {
    const deviationId = id();
    const deviation = { deviationId, status: 'open', dateCreated: new Date(clock.now()).toISOString(), captureSource: 'log', ...row };
    state.deviations.set(deviationId, deviation);
    state.events.set(deviationId, []);
    return deviation;
  };
  const evaluate = (subjectId: number, actorId: number) => {
    const subject = state.subjects.get(subjectId)!;
    const { saveRule, absenceRule } = plan;
    const outcomes = [
      { rule_id: saveRule.ruleId, status: subject.value === undefined ? 'skipped_missing_data' : subject.value === saveRule.violatingValue ? 'violated' : 'passed' },
      { rule_id: absenceRule.ruleId, status: subject.visits.length === 0 && subject.enrollmentDate === absenceRule.anchorDate ? 'violated' : 'passed' },
      ...(plan.applicability ? [{ rule_id: plan.applicability.versionedRuleId, status: 'passed' }] : []),
    ];
    const receipt = { evaluationId: randomUUID(), actorId, specHash: plan.study.expectedSpecHash, evaluatedAt: new Date(clock.now()).toISOString(), outcomes };
    state.receipts.set(subjectId, [...(state.receipts.get(subjectId) ?? []), receipt]);
    for (const outcome of outcomes.filter(entry => entry.status === 'violated')) {
      const open = [...state.deviations.values()].some(row => row.studySubjectId === subjectId && row.ruleId === outcome.rule_id && row.status === 'open');
      if (!open) {
        logDeviation({ studyId: subject.studyId, studySubjectId: subjectId, category: 'study_procedures', severity: 'major', description: `Machine detection ${outcome.rule_id}`,
          loggedBy: actorId, detectionSource: 'machine', ruleId: outcome.rule_id,
          occurredOn: outcome.rule_id === saveRule.ruleId ? subject.visitDate ?? subject.enrollmentDate : subject.enrollmentDate,
          occurredOnBasis: outcome.rule_id === saveRule.ruleId ? 'visit-date' : 'window-closed' });
      }
    }
    return receipt;
  };

  const appendEvent = (deviationId: number, actorId: number | null, kind: string, payload: Record<string, unknown>) => {
    const events = state.events.get(deviationId)!;
    const user = actorId === null ? null : byId.get(actorId);
    const event = { eventId: id(), deviationId, revision: events.length + 1, kind, actorId, actorUsername: user?.username ?? 'system',
      createdAt: new Date(clock.now()).toISOString(), sourceHash: sha(`source-${deviationId}`), payload };
    events.push(event);
    return event;
  };
  const inForceAssessment = (deviationId: number) => [...(state.events.get(deviationId) ?? [])].reverse().find(event => event.kind === 'assess') ?? null;

  // The cron: domain events (the follow-up task), the deviation sweep and O-2's escalations, once per tick.
  clock.onTick(() => {
    const now = clock.now();
    if (engine) {
      for (const subject of state.subjects.values()) {
        if (subject.studyId === site && subject.visits.length === 0 && subject.enrollmentDate === plan.absenceRule.anchorDate && !(state.receipts.get(subject.id) ?? []).length) evaluate(subject.id, 1);
      }
    }
    if (options.domainEvents ?? true) {
      for (const row of state.deviations.values()) {
        if (row.detectionSource === 'machine' && plan.followUpTask && !state.followUps.has(row.deviationId)) {
          state.followUps.add(row.deviationId);
          state.tasks.push({ taskId: id(), taskType: 'study_task', title: 'Follow up the deviation', description: 'Configured follow-up', studyId: root,
            entityType: 'acc_protocol_deviations', entityId: row.deviationId, metadata: { sourceStudyTaskId: plan.followUpTask.studyTaskId, triggerContext: { entityId: row.deviationId } } });
        }
      }
    }
    const policy = state.policy.inForce;
    const escalates = options.recipientHoldsRole ?? true;
    const holderNowhere = !escalates && !options.recipientAtParent;
    if (o2 === 'present' && policy && (escalates || (holderNowhere && (options.heldAttempts ?? true)))) {
      for (const row of state.deviations.values()) {
        if (row.studyId !== site || row.status !== 'open') continue;
        const events = state.events.get(row.deviationId)!;
        const escalate = (clockKey: string) => {
          if (!escalates) {
            // Nobody holds the role: O-2 holds the level and retries it (acc_deviation_escalation_attempt), creating no task.
            const attempts = (state.attempts.get(row.deviationId) ?? []).filter(attempt => attempt.clockKey !== clockKey);
            state.attempts.set(row.deviationId, [...attempts, { clockKey, level: 1, status: 'held', code: 'RECIPIENT_UNAVAILABLE', lastAttemptAt: new Date(now).toISOString() }]);
            return;
          }
          const taskId = id();
          state.tasks.push({ taskId, taskType: 'deviation_escalation', title: 'DEVIATION_ESCALATION', description: `clock ${clockKey} level 1`, studyId: site,
            entityType: 'protocol_deviation', entityId: row.deviationId, metadata: { clockKey, level: 1 } });
          appendEvent(row.deviationId, null, 'escalate', { clockKey, level: 1, taskId, recipientRole: options.escalationRecipientRole ?? plan.escalation.recipientRole,
            recipientUserIds: options.escalationRecipientUserIds ?? [recipientUserId], reason: 'ESCALATION_DUE' });
        };
        if (!events.some(event => event.kind === 'assess') && !events.some(event => event.kind === 'escalate' && event.payload.clockKey === 'assessment')
          && now - Date.parse(row.dateCreated) >= 60 * 60_000) escalate('assessment');
        const planEvent = [...events].reverse().find(event => event.kind === 'plan');
        if (planEvent && Date.parse(planEvent.payload.dueAt) <= now && !events.some(event => event.kind === 'escalate' && event.payload.clockKey === `corrective-action:${planEvent.revision}`)) {
          escalate(`corrective-action:${planEvent.revision}`);
        }
      }
    }
  });

  const documentFor = (kind: string, user: FakeUser) => {
    const included = user.unblinded, leak = !included && options.blindedLeaksArms;
    const armGrouping = included ? 'included' : 'withheld';
    if (kind === 'milestone') {
      return { schemaVersion: 'edc-milestone-measurement/1', studyId: root, armGrouping, milestones: { derived: {
        firstDosed: { platform: null, arms: included ? [{ armId: 1, firstDosed: null }] : 'withheld' },
        armRecruitment: [{ armId: 1, plannedCount: 5, ...(included || leak ? { allocated: 3, targetReachedAt: null } : { targetReachedAt: 'withheld', status: 'withheld' }) }] } },
      intervals: [{ metric: 'arm-may-proceed-to-first-dosed', scope: { studyId: root, armId: 1 }, status: included ? 'measured' : 'withheld' }],
      ...(included ? { byArm: { 1: { allocated: 3 } } } : {}) };
    }
    if (kind === 'effort') return { schemaVersion: 'edc-effort-ledger/1', studyId: root, armGrouping, windows: [{ metric: 'arm-may-proceed-to-first-dosed', scope: { armId: 1 }, status: included ? 'closed' : 'withheld' }] };
    if (kind === 'latency') return { schemaVersion: 'edc-latency-measurement/1', studyId: root, armGrouping, ...(included || leak ? { byArm: { 1: {} } } : {}) };
    return { ...Object.fromEntries(TA3_LEDGER_REQUIRED.map(key => [key, null])), schemaVersion: 'edc-ta3-ledger/1', studyId: root, armGrouping,
      snapshot: { isolation: 'repeatable-read-read-only', single: true }, ...(leak ? { pointers: { latency: { byArm: {} } } } : {}) };
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake.invalid'), method = req.method ?? 'GET', path = url.pathname;
      calls.push(`${method} ${path}`);
      const raw = Buffer.concat(chunks);
      let body: any = {};
      if (!String(req.headers['content-type'] ?? '').startsWith('multipart/') && raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { body = {}; } }
      const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(payload));
      };
      const exact = (bytes: Buffer, headers: Record<string, string>) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(bytes); };
      const notFound = () => send(404, { success: false, message: `Route ${method} ${path} not found` });
      const ok = (data: unknown, status = 200, headers: Record<string, string> = {}) => send(status, { success: true, data }, headers);
      const refuse = (status: number, message: string, extra: Record<string, unknown> = {}) => send(status, { success: false, message, ...extra });

      if (method === 'POST' && path === '/api/auth/login') {
        const user = users.get(String(body.username));
        if (!user || user.password !== body.password) return refuse(401, 'Invalid username or password');
        logins.set(user.username, (logins.get(user.username) ?? 0) + 1);
        const issued = token(user.userId, clock.now() + lifetime);
        state.tokens.set(issued, { userId: user.userId, exp: clock.now() + lifetime, lastUsed: clock.now(), revoked: false });
        return send(200, { success: true, accessToken: issued, user: { userId: user.userId, username: user.username } });
      }
      const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      const session = state.tokens.get(bearer);
      const expired = session && (session.exp <= clock.now() || clock.now() - session.lastUsed > 30 * 60_000);
      if (!session || session.revoked || expired) {
        unauthorized++;
        return send(401, { success: false, error: { code: !session || session.revoked ? 'TOKEN_REVOKED' : 'SESSION_TIMEOUT' } });
      }
      session.lastUsed = clock.now();
      const user = byId.get(session.userId)!;
      if (method === 'POST' && path === '/api/auth/logout') { session.revoked = true; return send(200, { success: true }); }
      if (options.revokeFirstSessionOf === user.username && !revokedOnce && ++requestsBeforeRevocation === 2) {
        revokedOnce = true; session.revoked = true; unauthorized++;
        return send(401, { success: false, error: { code: 'SESSION_REVOKED', message: 'Session has been revoked' } });
      }

      const signed = typeof body.signaturePassword === 'string' && body.signaturePassword !== '';
      const signature = (meaning: string) => (signed ? { verified: true, signerId: user.userId, signerUsername: user.username, meaning, signedAt: new Date(clock.now()).toISOString() } : null);
      if (signed && (options.signatureRefused ?? []).includes(user.username)) return refuse(401, 'Invalid electronic signature credentials');
      if (signed && (body.signatureUsername !== user.username || body.signaturePassword !== user.password)) return refuse(401, 'Invalid electronic signature credentials');
      const engineOff = () => refuse(503, 'The automatic protocol-deviation engine is disabled. Set ENABLE_DEVIATION_ENGINE=true to enable it. Deviations can still be logged manually.');
      const trainingRefused = () => (options.trainingRefused ?? []).includes(user.username)
        ? (refuse(409, 'Current independently verified training or an explicitly reviewed no-extra-training disposition is required for this delegated clinical duty.', { details: { code: 'TRAINING_DUTY_INCOMPLETE' } }), true) : false;
      let match: RegExpExecArray | null;

      // Clinical writes and reads.
      if (method === 'POST' && path === '/api/subjects') {
        if (trainingRefused()) return;
        const subjectId = id();
        state.subjects.set(subjectId, { id: subjectId, studyId: Number(body.studyId), enrollmentDate: String(body.enrollmentDate), visits: [] });
        return ok({ studySubjectId: subjectId }, 201);
      }
      if (method === 'POST' && path === '/api/events/schedule') {
        if (trainingRefused()) return;
        const subject = state.subjects.get(Number(body.studySubjectId))!;
        const visitId = id(), eventCrfId = id();
        subject.visits.push(visitId);
        subject.visitDate = String(body.scheduledDate);
        state.forms.set(eventCrfId, { subjectId: subject.id, visitId });
        return ok({ studyEventId: visitId }, 201);
      }
      if (method === 'GET' && (match = /^\/api\/events\/instance\/(\d+)\/crfs$/.exec(path))) {
        const visitId = Number(match[1]);
        const [eventCrfId] = [...state.forms.entries()].find(([, form]) => form.visitId === visitId) ?? [];
        return ok([{ crfVersionId: plan.saveRule.crfVersionId, crfId: 61, eventCrfId, studyEventId: visitId }]);
      }
      if (method === 'GET' && (match = /^\/api\/forms\/data\/(\d+)$/.exec(path))) {
        return ok({ eventCrfId: Number(match[1]), observationSnapshotHash: `sha256:${sha(`form-${match[1]}-${clock.now()}`)}`, execution: null, formData: {} });
      }
      if (method === 'POST' && path === '/api/forms/save') {
        if (trainingRefused()) return;
        const form = state.forms.get(Number(body.eventCrfId))!;
        state.subjects.get(form.subjectId)!.value = String(body.formData[`item_${plan.saveRule.itemId}`]);
        if (engine) evaluate(form.subjectId, user.userId);
        return send(200, { success: true });
      }

      // The deviation engine.
      if (path.startsWith('/api/deviation-engine/')) {
        const applicabilityPost = method === 'POST' && path === '/api/deviation-engine/protocol-applicability';
        if (applicabilityPost && !['admin', 'data_manager'].includes(user.role)) return refuse(403, 'Insufficient permissions');
        if (!engine && ['/api/deviation-engine/spec', '/api/deviation-engine/evaluations', '/api/deviation-engine/outcomes', '/api/deviation-engine/evaluate',
          '/api/deviation-engine/protocol-applicability'].some(prefix => path === prefix || path.startsWith(`${prefix}/`))) return engineOff();
        if (method === 'GET' && path === '/api/deviation-engine/spec') {
          return ok({ hasSpec: true, specId: 'synthetic-spec-1', specVersion: 2, ruleCount: 3, machineCount: 3,
            sourceManifest: { releaseBinding: { contract: 'edc-deviation-spec-release-binding/1', cslReleaseId: plan.study.expectedCslReleaseId ?? null } } });
        }
        if (method === 'GET' && path === '/api/deviation-engine/evaluations') {
          return ok({ evaluations: [...(state.receipts.get(Number(url.searchParams.get('studySubjectId'))) ?? [])].reverse() });
        }
        if ((match = /^\/api\/deviation-engine\/evaluations\/([0-9a-f-]{36})$/.exec(path))) {
          if (method !== 'GET') return notFound();
          const receipt = (state.receipts.get(Number(url.searchParams.get('studySubjectId'))) ?? []).find(entry => entry.evaluationId === match![1]);
          return receipt ? exact(Buffer.from(`{"success":true,"data":${JSON.stringify(receipt)}}`), {}) : refuse(404, 'Evaluation receipt not found for this subject');
        }
        if (method === 'GET' && path === '/api/deviation-engine/outcomes') {
          const subjectId = Number(url.searchParams.get('studySubjectId'));
          const latest = (state.receipts.get(subjectId) ?? []).at(-1);
          const subject = state.subjects.get(subjectId)!;
          const applicability = applicabilityFor(subject);
          return ok({ studySubjectId: subjectId, outcomes: latest ? latest.outcomes.map((outcome: any) => ({ ruleId: outcome.rule_id, status: outcome.status,
            ...(applicability && outcome.rule_id === plan.applicability?.versionedRuleId ? { applicability } : {}) })) : [] });
        }
        if (method === 'POST' && path === '/api/deviation-engine/evaluate') return ok({ evaluated: true, evaluationId: evaluate(Number(body.studySubjectId), user.userId).evaluationId });
        if (path === '/api/deviation-engine/protocol-applicability') {
          if (method === 'GET') {
            const current = new Set(currentRecords().map(record => record.applicabilityId));
            return ok({ studyId: site, records: state.applicability.map(record => ({ ...record, current: current.has(record.applicabilityId) })) });
          }
          const record = { applicabilityId: id(), studyId: Number(body.studyId), protocolVersion: body.protocolVersion, status: body.status, effectiveFrom: body.effectiveFrom ?? null,
            ethicsApprovalDate: body.ethicsApprovalDate ?? null, documentedOn: body.documentedOn ?? null, basis: body.basis, recordedBy: user.userId, recordedAt: new Date(clock.now()).toISOString() };
          state.applicability.push(record);
          return ok(record, 201);
        }
        return notFound();
      }

      // The deviation log, O-1 decisions and O-2 escalation policy.
      if (path === '/api/protocol-deviations/escalation-policy') {
        if (o2 === 'absent') {
          return method === 'GET' ? refuse(400, 'Validation failed', { errors: [{ field: 'deviationId', message: '"deviationId" must be a number', type: 'number.base' }] }) : notFound();
        }
        const workspace = () => ({ revision: state.policy.revision, sourceHash: sha(`policy-${state.policy.revision}`), inForce: state.policy.inForce,
          pendingProposal: state.policy.proposals.find(entry => !entry.reviewed) ?? null,
          ...(options.workspaceOmitsDecisionsEnabled ? {} : { decisionsEnabled: o2 !== 'disabled' }) });
        if (method === 'GET') return ok(workspace());
        if (o2 === 'disabled') return refuse(503, 'Protocol-deviation decisions are disabled.', { code: 'DEVIATION_DECISIONS_DISABLED' });
        if (!signed) return refuse(403, 'Electronic signature required for this action (21 CFR Part 11 §11.50).', { code: 'SIGNATURE_REQUIRED' });
        if (body.revision !== state.policy.revision) return refuse(409, 'The policy changed; reload');
        if (body.kind === 'propose') {
          const proposal = { proposeEventId: id(), proposerId: user.userId, policy: body.policy, reviewed: false };
          state.policy.proposals.push(proposal); state.policy.revision++;
          return ok({ event: { eventId: proposal.proposeEventId, kind: 'propose' } }, 201);
        }
        const proposal = state.policy.proposals.find(entry => entry.proposeEventId === body.proposeEventId);
        if (!proposal) return refuse(409, 'No such proposal');
        if (proposal.proposerId === user.userId) return refuse(403, 'A different person reviews the policy');
        proposal.reviewed = true; state.policy.revision++;
        if (body.accepted) state.policy.inForce = { proposeEventId: proposal.proposeEventId, policy: proposal.policy };
        return ok({ event: { eventId: id(), kind: 'review' } }, 201);
      }
      if (method === 'GET' && path === '/api/protocol-deviations') {
        const studyId = Number(url.searchParams.get('studyId'));
        const includeSites = url.searchParams.get('includeSites') === 'true' && o1 !== 'absent';
        const source = url.searchParams.get('detectionSource');
        const rows = [...state.deviations.values()].filter(row => (row.studyId === studyId || (includeSites && studyId === root && row.studyId === site))
          && (!source || row.detectionSource === source)).reverse();
        const page = Number(url.searchParams.get('page') ?? 1), size = Number(url.searchParams.get('pageSize') ?? 25);
        return ok({ deviations: rows.slice((page - 1) * size, page * size).map(serialize), total: rows.length, page, pageSize: size });
      }
      if (method === 'POST' && path === '/api/protocol-deviations') {
        if (o1 === 'absent' && body.occurredOn !== undefined) {
          return refuse(400, 'Validation failed', { errors: [{ field: 'occurredOn', message: '"occurredOn" is not allowed', type: 'object.unknown' }] });
        }
        const row = logDeviation({ studyId: Number(body.studyId), studySubjectId: body.studySubjectId, category: body.category, severity: body.severity, description: body.description,
          loggedBy: user.userId, detectionSource: 'manual', occurredOn: body.occurredOn ?? day(clock.now()), occurredOnBasis: body.occurredOn ? 'stated' : 'recorded-date' });
        return ok(serialize(row), 201);
      }
      if ((match = /^\/api\/protocol-deviations\/(\d+)(\/.*)?$/.exec(path))) {
        const deviationId = Number(match[1]), rest = match[2] ?? '';
        const row = state.deviations.get(deviationId);
        if (!row) return refuse(404, `Deviation ${deviationId} not found`);
        const events = state.events.get(deviationId)!;
        const revision = events.length;
        const sourceHash = sha(`source-${deviationId}`);
        const stale = () => body.revision !== revision || body.sourceHash !== sourceHash;
        if (method === 'GET' && rest === '') return ok(serialize(row));
        if (method === 'GET' && rest === '/corrective-action') {
          const assessment = inForceAssessment(deviationId);
          return ok({ revision, sourceHash, history: events, escalationAttempts: state.attempts.get(deviationId) ?? [], ...(o1 === 'absent' ? {} : { assessment: assessment ? {
            eventId: assessment.eventId, revision: assessment.revision, disposition: assessment.payload.disposition, importance: assessment.payload.importance ?? null,
            assessedBy: { userId: assessment.actorId, username: assessment.actorUsername }, assessedAt: assessment.createdAt, signature: assessment.payload.signature } : null }) });
        }
        if (method === 'POST' && /^\/corrective-action\/evidence\/[0-9a-f-]{36}$/.test(rest)) return ok({ fileId: rest.split('/').at(-1) });
        if (method === 'POST' && rest === '/assessment') {
          if (o1 === 'absent') return notFound();
          if (o1 === 'disabled') return refuse(503, 'Protocol-deviation decisions are disabled.', { code: 'DEVIATION_DECISIONS_DISABLED' });
          if (!['admin', 'data_manager', 'investigator'].includes(user.role)) return refuse(403, 'Insufficient permissions');
          if (!signed) return refuse(403, 'Electronic signature required for this action (21 CFR Part 11 §11.50).', { code: 'SIGNATURE_REQUIRED' });
          if (!['confirmed', 'not_a_deviation'].includes(body.disposition) || (body.disposition === 'confirmed') !== (body.importance !== undefined)) return refuse(400, '"importance" rule');
          if (stale()) return refuse(409, 'The finding or corrective action changed; refresh and review the current evidence');
          if (row.loggedBy === user.userId) return refuse(403, 'A deviation is assessed by a person other than the one who logged it');
          const event = appendEvent(deviationId, user.userId, 'assess', { disposition: body.disposition, ...(body.importance ? { importance: body.importance } : {}),
            reason: body.rationale, signature: signature(EDC_SIGNATURE_MEANINGS.DEVIATION_ASSESSMENT_MEANING) });
          return ok({ event, replayed: false }, 201);
        }
        if (method === 'POST' && rest === '/close') {
          if (body.closureKind === 'not-a-deviation' && o1 !== 'present') return o1 === 'absent' ? refuse(400, 'Validation failed', { errors: [{ field: 'closureKind', type: 'object.unknown' }] })
            : refuse(503, 'Protocol-deviation decisions are disabled.', { code: 'DEVIATION_DECISIONS_DISABLED' });
          if (stale()) return refuse(409, 'Stale');
          const assessment = inForceAssessment(deviationId);
          if (!signed || assessment?.payload.disposition !== 'not_a_deviation') return refuse(409, 'An assessment in force that this is not a deviation is required for this closure');
          if (assessment.actorId === user.userId) return refuse(403, 'A person other than the assessor closes a deviation as not a deviation');
          appendEvent(deviationId, user.userId, 'close', { closureKind: 'not-a-deviation', reason: body.reason, signature: signature(EDC_SIGNATURE_MEANINGS.DEVIATION_CLOSURE_MEANING) });
          row.status = 'closed';
          return ok(serialize(row));
        }
        if (method === 'POST' && rest === '/corrective-action') {
          if (signed && body.kind !== 'review') return refuse(400, 'This corrective-action step takes no electronic signature');
          if (stale()) return refuse(409, 'The finding or corrective action changed; refresh and review the current evidence');
          const planEvent = [...events].reverse().find(event => event.kind === 'plan');
          const completion = [...events].reverse().find(event => event.kind === 'complete');
          if (body.kind === 'plan') return ok(appendEvent(deviationId, user.userId, 'plan', { ownerId: body.ownerId, dueAt: body.dueAt, reason: body.reason }));
          if (!planEvent) return refuse(409, 'Record a corrective-action plan first');
          if (body.kind === 'complete') {
            if (user.userId !== planEvent.payload.ownerId) return refuse(403, 'Only the current action owner may record completion');
            return ok(appendEvent(deviationId, user.userId, 'complete', { evidenceFileId: body.evidenceFileId }));
          }
          const assessment = inForceAssessment(deviationId);
          if (assessment && !signed) return refuse(403, 'The effectiveness review of an assessed deviation requires your electronic signature', { code: 'SIGNATURE_REQUIRED' });
          if (!completion) return refuse(409, 'Record completion against the current source before review');
          if ([planEvent.actorId, planEvent.payload.ownerId, completion.actorId].includes(user.userId)) return refuse(403, 'A different investigator or data manager must verify effectiveness independently of the planner and action owner');
          return ok(appendEvent(deviationId, user.userId, 'review', { effective: body.effective, ...(signed ? { signature: signature('effectiveness') } : {}) }));
        }
        return notFound();
      }

      // Workflow tasks and study tasks.
      if (method === 'GET' && path === '/api/workflows') return ok(state.tasks.filter(task => task.studyId === Number(url.searchParams.get('studyId'))));
      if (method === 'GET' && (match = /^\/api\/study-tasks\/(\d+)$/.exec(path))) {
        return ok({ studyTaskId: Number(match[1]), triggerType: 'action', actionTrigger: { eventType: 'deviation.logged', filters: {} }, triggerCount: 0 });
      }

      // Sites: staff, lifecycle evidence, milestones and retained documents.
      if (method === 'GET' && path === `/api/sites/${site}/staff`) {
        if ((options.siteStaffStatus ?? 200) !== 200) return refuse(options.siteStaffStatus!, 'Insufficient permissions');
        return ok([{ ...recipientEntry, role: (options.recipientHoldsRole ?? true) ? plan.escalation.recipientRole : 'viewer' }]);
      }
      if (method === 'GET' && path === `/api/sites/${root}/staff`) {
        return ok([...platformStaff, ...(options.recipientAtParent ? [recipientEntry] : [])]);
      }
      if (method === 'POST' && (match = new RegExp(`^/api/sites/study/${site}/lifecycle/evidence/([0-9a-f-]{36})$`).exec(path))) { state.uploads.add(match[1]); return ok({ fileId: match[1] }); }
      if (path === `/api/sites/study/${root}/milestones`) {
        const workspace = () => ({ revision: state.milestones.revision, sourceHash: sha(`milestones-${state.milestones.revision}`), records: state.milestones.records,
          inForce: state.milestones.records.filter(entry => entry.review?.accepted), pendingReview: state.milestones.records.filter(entry => !entry.review) });
        if (method === 'GET') return ok(workspace());
        if (!signed) return refuse(403, 'Electronic signature required for this action (21 CFR Part 11 §11.50).', { code: 'SIGNATURE_REQUIRED' });
        if (body.revision !== state.milestones.revision) return refuse(409, 'Milestone history changed; reload before deciding');
        if (body.kind === 'record') {
          if (!state.uploads.has(body.evidence?.fileId)) return refuse(400, 'The retained original is not of this scope');
          const record = { recordEventId: id(), milestone: body.milestone, scopeStudyId: body.scopeStudyId, recordedBy: { userId: user.userId, username: user.username }, review: null as any };
          state.milestones.records.push(record); state.milestones.revision++;
          return ok({ event: { eventId: record.recordEventId, kind: 'record' }, replayed: false }, 201);
        }
        const record = state.milestones.records.find(entry => entry.recordEventId === body.recordEventId);
        if (!record || record.review) return refuse(409, 'An exact milestone record awaiting review is required');
        if (record.recordedBy.userId === user.userId) return refuse(403, 'A different investigator or data manager of the scope must review this milestone');
        record.review = { accepted: body.accepted === true, reviewedBy: { userId: user.userId } }; state.milestones.revision++;
        return ok({ event: { eventId: id(), kind: 'review' }, replayed: false }, 201);
      }
      const documentRoutes: Record<string, string> = { [`/api/sites/study/${root}/milestone-measurements`]: 'milestone', [`/api/sites/study/${root}/effort-ledger`]: 'effort',
        '/api/data-cuts/latency-measurements': 'latency', [`/api/sites/study/${root}/ta3-ledgers`]: 'ledger' };
      const documentBase = Object.keys(documentRoutes).find(base => path === base || path.startsWith(`${base}/`));
      if (documentBase) {
        const kind = documentRoutes[documentBase];
        if (kind === 'ledger' && !m2) return notFound();
        const list = state.documents.get(kind) ?? [];
        state.documents.set(kind, list);
        const idKey = kind === 'latency' ? 'measurementId' : 'documentId';
        const recordKey = kind === 'effort' || kind === 'ledger' ? 'ledger' : 'measurement';
        if (method === 'POST' && path === documentBase) {
          const requestHash = sha(JSON.stringify({ kind, userId: user.userId, from: body.from ?? null, to: body.to ?? null }));
          const prior = list.find(entry => entry.record.requestKey === body.requestKey);
          if (prior) {
            if (prior.requestHash !== requestHash) return refuse(409, 'This request key belongs to a different request. Use a new key.');
            return ok({ [recordKey]: prior.record, document: JSON.parse(prior.bytes.toString('utf8')) }, 200, { 'X-Content-SHA256': prior.record.contentHash });
          }
          const bytes = Buffer.from(JSON.stringify(documentFor(kind, user)));
          const record = { [idKey]: id(), requestKey: body.requestKey, contentHash: sha(bytes), armGrouping: user.unblinded ? 'included' : 'withheld' };
          list.push({ record, bytes, requestHash });
          return ok({ [recordKey]: record, document: JSON.parse(bytes.toString('utf8')) }, 201, { 'X-Content-SHA256': record.contentHash });
        }
        if (method === 'GET' && path === documentBase) return ok(list.map(entry => entry.record).filter(record => user.unblinded || record.armGrouping !== 'included'));
        if (method === 'GET') {
          const found = list.find(entry => String(entry.record[idKey]) === path.slice(documentBase.length + 1));
          if (!found) return refuse(404, 'Not found');
          if (found.record.armGrouping === 'included' && !user.unblinded) return refuse(403, 'This document includes arm grouping; it requires the per-study unblinded role');
          return exact(found.bytes, { 'X-Content-SHA256': found.record.contentHash });
        }
        return notFound();
      }

      // Inspection copies.
      const copyBase = `/api/regulatory-export/inspection-package/${root}`;
      if (path === copyBase || path.startsWith(`${copyBase}/`)) {
        if (!['admin', 'data_manager'].includes(user.role)) return refuse(403, 'Insufficient permissions');
        if (method === 'POST') {
          const segmented = body.profile !== undefined;
          if (segmented && w1 === 'absent') return refuse(400, 'Supply a UUID requestKey and optional boolean includeTraining');
          if (segmented && w1 === 'disabled') return refuse(503, 'Segmented inspection export is disabled.', { code: 'SEGMENTED_INSPECTION_EXPORT_DISABLED' });
          const prior = state.packages.find(entry => entry.packageId === body.requestKey);
          if (prior) return ok({ ...prior.receipt, replay: true });
          if (segmented) {
            const receipt = { packageId: body.requestKey, packageVersion: 'edc-inspection-copy/3' };
            state.packages.push({ packageId: body.requestKey, segmented: true, receipt });
            return ok({ ...receipt, replay: false }, 201);
          }
          const withTa3 = ta3Inventory && w1 !== 'absent';
          const tables = ['acc_protocol_deviations', 'acc_deviation_action_events', ...(withTa3 ? TA3_INSPECTION_COVERAGE
            .filter(entry => !entry.segmentedOnly && (!entry.late || (entry.late.item === 'O-2' && o2 !== 'absent'))).map(entry => entry.table) : [])];
          const rows: Record<string, unknown[]> = {
            acc_protocol_deviations: [...state.deviations.values()].map(row => ({ nativeJson: JSON.stringify({ deviation_id: row.deviationId }) })),
            acc_deviation_action_events: [...state.events.values()].flat().map(event => ({ nativeJson: JSON.stringify({ deviation_id: event.deviationId, event_id: event.eventId }) })),
          };
          const packet = { manifest: { schemaVersion: 'edc-inspection-copy/1', packageId: body.requestKey, studyIds: [root, site],
            additionalStores: tables.map(table => ({ table, count: rows[table]?.length ?? 0, contentHash: sha(table) })),
            limitations: withTa3 ? [W1_SEGMENTED_LIMITATION] : ['Synthetic limitation'] },
          additionalStores: tables.map(table => ({ table, rows: rows[table] ?? [] })) };
          const bytes = Buffer.from(JSON.stringify(packet));
          const receipt = { packageId: body.requestKey, fileSha256: sha(bytes), byteCount: bytes.length, manifest: { schemaVersion: packet.manifest.schemaVersion } };
          state.packages.push({ packageId: body.requestKey, segmented: false, receipt, bytes });
          return ok({ ...receipt, replay: false }, 201);
        }
        if (method === 'GET' && path === copyBase) {
          const segmented = url.searchParams.get('profile') === 'edc-inspection-copy/3' && w1 === 'present';
          return ok({ packages: state.packages.filter(entry => entry.segmented === segmented).map(entry => entry.receipt), next: null });
        }
        const found = state.packages.find(entry => entry.packageId === path.slice(copyBase.length + 1) && !entry.segmented);
        return found ? exact(found.bytes, { 'X-Source-SHA256': found.receipt.fileSha256 }) : refuse(404, 'Published inspection package not found');
      }
      return notFound();
    });
  });

  function serialize(row: any): Record<string, unknown> {
    if (o1 !== 'absent') return row;
    const { occurredOn: _occurredOn, occurredOnBasis: _basis, captureSource: _source, ...legacy } = row;
    return legacy;
  }

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`, calls, logins, state,
    get unauthorized() { return unauthorized; },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
