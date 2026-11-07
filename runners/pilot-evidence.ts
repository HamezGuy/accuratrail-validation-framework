import * as fs from 'node:fs';
import * as path from 'node:path';
import { isInside, isRecord, SHA256_HEX, type EvidenceResult } from './evidence-capture';
import { sha256 as hash } from './vendored-archive';
import { caseFail, casePass, isCount, isInstant, isText, membersProblem, type CaseOutcome, type SummaryDerivationInput } from './summary-reading';
import type { PublicDataAdmission } from './public-data-admission';
import { ta3RegulatoryRef } from '../config/ta3-oq-cases';
import {
  PILOT_ACCEPTANCE_CONTRACT, PILOT_CONTROL_SYSTEMS, PILOT_CONTROLS, PILOT_MIN_CRITICAL_INSTANCES, PILOT_NON_CLAIMS, PILOT_NON_CLAIM_STATUSES,
  PILOT_PQ_CASES, PILOT_STUDY, PUBLIC_DATA_BASIS_NOT_ADMITTED, UNSUPPORTED_PILOT_SUMMARY, type PilotControl, type Ta3PqCase,
} from '../config/ta3-pq-cases';

/*
 * The lab-to-endpoint pilot cases (LE-7.2): PQA-001 to PQA-021 and PQC-001 to PQC-004, derived from a reconstructed run whose
 * summary states cdisc-pilot-acceptance-summary/1. The benchmark import registers derivePilotResults for that contract
 * (SUMMARY_CONTRACTS, runners/benchmark-evidence.ts). Beside the derivation sits what it recorded about each cited run file,
 * so verify:package --run-dir rechecks a run directory by the same statuses (pilotRowRunFiles).
 */

export interface PilotDerivationInput extends SummaryDerivationInput {
  /** Reads one evidence file the summary cites, by absolute path; injected so the derivation reads nothing else. */
  readEvidence?: (absolutePath: string) => Buffer;
  /** The D-LE-14 decision on this run; an R2 run passes no case without an admission. */
  publicData?: PublicDataAdmission;
}

const PILOT_SCOPE = 'Derived from the reconstructed pilot run without re-scoring: the import admits the run\'s verdict for a case only with every '
  + 'evidence file it cites verified by SHA-256 under the run directory, complete coverage and an answer key whose own manifest and seal record show it sealed before the run; it does not '
  + 're-judge the evidence content. An R1 run is synthetic engineering evidence (D-LE-14) with mechanical or builder-declared keys (D-LE-21); only '
  + 'an R2 run with countersigned keys and the declared-public-data basis is the run of record.';
const PILOT_MEMBERS = ['runKind', 'startedAt', 'classification', 'keySet', 'cases', 'controls'];
const PILOT_KEY_SET_MEMBERS = ['keySetId', 'manifestSha256', 'sealedAt', 'criticalInstancesDeclared', 'manifest', 'seal'];
const PILOT_NON_CLAIM_MEMBERS = ['claim', 'status', 'decision'];
const PILOT_CASE_MEMBERS = ['case', 'requirement', 'verdict', 'coverage', 'scoredInstances', 'criticalInstances', 'criticalFailures', 'keyBasis', 'evidence'];
const PILOT_CONTROL_MEMBERS = ['control', 'requirement', 'systems'];
const PILOT_VERDICTS = ['pass', 'fail', 'inconclusive', 'not-run'];
const PILOT_COVERAGE = ['complete', 'incomplete'];
const PILOT_KEY_BASES = ['mechanical', 'builder-declared', 'countersigned'];
/** The counts each control reports per system (the LE-7.3 producer writes exactly these members). */
const PILOT_CONTROL_COUNTS: Readonly<Record<PilotControl, readonly string[]>> = {
  security: ['probes', 'refusedAsExpected', 'unexpectedAcceptances'],
  'backup-restore': ['backupTaken', 'restoredIsolated', 'sourceDigest', 'restoredDigest', 'recoveryPointSeconds', 'recoveryTimeSeconds'],
  'signature-linking': ['signatures', 'linked', 'digestRecomputedEqual', 'unlinked', 'mismatched'],
  'access-census': ['accessEvents', 'accountChangeEvents', 'accountsDeclared', 'accountsFound', 'accountsUndeclared', 'windowStart'],
};

export interface PilotRunBlock {
  runKind: 'R1' | 'R2';
  startedAt: string;
  classification: { kind: string; basisRef?: string; basisSha256?: string };
  keySet: {
    keySetId: string; manifestSha256: string; sealedAt: string; criticalInstancesDeclared: number;
    manifest: { path: string; sha256: string }; seal: { path: string; sha256: string };
  };
  cases: Record<string, unknown>[];
  controls: Record<string, unknown>[];
  nonClaims?: { claim: string; status: string; decision: string }[];
}

/** What a run does not claim, read strictly: every claim the catalog names, in a status it allows. An R1 summary must state
 * the three non-claims OD-23 and OD-24 decide; R2 exercises the governed lane, so it cannot list that one. There is no
 * passed status, so a non-claim can never read as a pass. */
function nonClaimProblems(pilot: Record<string, unknown>): string[] {
  const value = pilot.nonClaims;
  const stated: Record<string, unknown>[] = [];
  const problems: string[] = [];
  if (value !== undefined) {
    if (!Array.isArray(value)) return ['pilot.nonClaims is not an array'];
    for (const [index, entry] of value.entries()) {
      const at = `pilot.nonClaims[${index}]`;
      const shape = membersProblem(entry, at, PILOT_NON_CLAIM_MEMBERS);
      if (shape) { problems.push(shape); continue; }
      const item = entry as Record<string, unknown>;
      if (!PILOT_NON_CLAIMS.some(known => known.claim === item.claim)) problems.push(`${at}.claim is ${JSON.stringify(item.claim)}, which the catalog lacks`);
      if (!(PILOT_NON_CLAIM_STATUSES as readonly unknown[]).includes(item.status)) problems.push(`${at}.status is ${JSON.stringify(item.status)}, not ${PILOT_NON_CLAIM_STATUSES.join(' or ')}`);
      if (!isText(item.decision, 64)) problems.push(`${at}.decision is not text`);
      if (stated.some(other => other.claim === item.claim)) problems.push(`pilot.nonClaims repeats ${String(item.claim)}`);
      stated.push(item);
    }
  }
  if (pilot.runKind === 'R1') {
    for (const required of PILOT_NON_CLAIMS) {
      const found = stated.find(item => item.claim === required.claim);
      if (!found) problems.push(`an R1 summary must state pilot.nonClaims ${required.claim} as ${required.status} (${required.decision})`);
      else if (found.status !== required.status || found.decision !== required.decision) problems.push(`pilot.nonClaims ${required.claim} must be ${required.status} (${required.decision}) on R1`);
    }
  }
  if (pilot.runKind === 'R2') {
    for (const item of stated) {
      if (PILOT_NON_CLAIMS.find(known => known.claim === item.claim)?.onR2 === false) problems.push(`an R2 run cannot state ${String(item.claim)} as a non-claim`);
    }
  }
  return problems;
}

/** The run block every pilot case reads, or the problems that make the whole summary unrecognised (never a guess). */
export function pilotRunBlock(summary: Record<string, unknown>): { run?: PilotRunBlock; problems: string[] } {
  const problems: string[] = [];
  const shape = membersProblem(summary.pilot, 'pilot', PILOT_MEMBERS, ['nonClaims']);
  if (shape) return { problems: [shape] };
  const pilot = summary.pilot as Record<string, unknown>;
  if (pilot.runKind !== 'R1' && pilot.runKind !== 'R2') problems.push(`pilot.runKind is ${JSON.stringify(pilot.runKind)}, not R1 or R2`);
  if (!isInstant(pilot.startedAt)) problems.push('pilot.startedAt is not an RFC 3339 instant');
  const classification = pilot.classification;
  const kind = isRecord(classification) ? classification.kind : undefined;
  const classificationShape = kind === 'synthetic-engineering' ? membersProblem(classification, 'pilot.classification', ['kind'])
    : kind === 'declared-public-data' ? membersProblem(classification, 'pilot.classification', ['kind', 'basisRef', 'basisSha256'])
      ?? (isText((classification as Record<string, unknown>).basisRef, 512) ? undefined : 'pilot.classification.basisRef is not text')
      ?? (SHA256_HEX.test(String((classification as Record<string, unknown>).basisSha256)) ? undefined : 'pilot.classification.basisSha256 is not a SHA-256 hex')
      : `pilot.classification.kind is ${JSON.stringify(kind)}, not synthetic-engineering or declared-public-data`;
  if (classificationShape) problems.push(classificationShape);
  const keyShape = membersProblem(pilot.keySet, 'pilot.keySet', PILOT_KEY_SET_MEMBERS);
  if (keyShape) problems.push(keyShape);
  else {
    const keySet = pilot.keySet as Record<string, unknown>;
    if (!isText(keySet.keySetId, 256)) problems.push('pilot.keySet.keySetId is not text');
    if (typeof keySet.manifestSha256 !== 'string' || !SHA256_HEX.test(keySet.manifestSha256)) problems.push('pilot.keySet.manifestSha256 is not a SHA-256 hex');
    if (!isInstant(keySet.sealedAt)) problems.push('pilot.keySet.sealedAt is not an RFC 3339 instant');
    if (!isCount(keySet.criticalInstancesDeclared)) problems.push('pilot.keySet.criticalInstancesDeclared is not a count');
    for (const member of ['manifest', 'seal']) {
      const file = keySet[member];
      const fileShape = membersProblem(file, `pilot.keySet.${member}`, ['path', 'sha256']);
      if (fileShape) { problems.push(fileShape); continue; }
      const { path: cited, sha256 } = file as Record<string, unknown>;
      if (!isText(cited, 1024) || typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) problems.push(`pilot.keySet.${member} is not a path with a SHA-256 hex`);
    }
    if (isRecord(keySet.manifest) && keySet.manifest.sha256 !== keySet.manifestSha256) problems.push('pilot.keySet.manifest.sha256 is not pilot.keySet.manifestSha256');
  }
  problems.push(...nonClaimProblems(pilot));
  const known = new Set(PILOT_PQ_CASES.map(entry => entry.acceptanceCase));
  for (const [member, key, allowed] of [['cases', 'case', /^A\d+$/], ['controls', 'control', null]] as const) {
    const list = pilot[member];
    if (!Array.isArray(list)) { problems.push(`pilot.${member} is not an array`); continue; }
    const seen = new Set<string>();
    for (const [index, entry] of list.entries()) {
      const id = isRecord(entry) ? entry[key] : undefined;
      const recognised = typeof id === 'string' && known.has(id) && (allowed ? allowed.test(id) : (PILOT_CONTROLS as readonly string[]).includes(id));
      if (!recognised) { problems.push(`pilot.${member}[${index}].${key} is ${JSON.stringify(id)}, which the catalog lacks`); continue; }
      if (seen.has(id as string)) problems.push(`pilot.${member} repeats ${id}`);
      seen.add(id as string);
    }
  }
  if (problems.length) return { problems };
  return { run: pilot as unknown as PilotRunBlock, problems };
}

/** The classification rule of D-LE-14: R1 keeps the synthetic classification, R2 needs the declared-public-data basis,
 * and an R2 case passes only from a run admitted under that basis, so a pass is never recorded in a synthetic package. */
function classificationFailure(run: PilotRunBlock, publicData?: PublicDataAdmission): CaseOutcome | undefined {
  const expected = run.runKind === 'R1' ? 'synthetic-engineering' : 'declared-public-data';
  if (run.classification.kind !== expected) {
    return caseFail('CLASSIFICATION_MISMATCH', `A ${run.runKind} run must be classified ${expected} (D-LE-14); it states ${run.classification.kind}.`,
      { classification: run.classification });
  }
  if (run.runKind !== 'R2' || publicData?.admitted) return undefined;
  const why = publicData && !publicData.admitted ? `${publicData.code}: ${publicData.reason}` : 'no admission was decided for this import';
  return caseFail(PUBLIC_DATA_BASIS_NOT_ADMITTED, `The R2 run was not admitted under a filed declared-public-data basis (D-LE-14). ${why}`,
    { classification: run.classification });
}


/** What the import found for one file a pilot result cites: verified (inside the run directory with the recorded SHA-256),
 * missing (inside, but nothing readable there), mismatch (inside, other bytes: actualSha256) or outside (not inside the run
 * directory, so never read). */
export const PILOT_EVIDENCE_STATUSES = ['verified', 'missing', 'mismatch', 'outside'] as const;
export type PilotEvidenceStatus = typeof PILOT_EVIDENCE_STATUSES[number];
export interface PilotEvidenceCheck { path: string; sha256: string; status: PilotEvidenceStatus; actualSha256?: string }

/** The file a cited relative path names inside the run directory, or undefined when it is outside: an absolute path, a
 * path that leaves the directory, or a link inside it that resolves outside it. */
export function citedRunFile(runDir: string, relative: string): string | undefined {
  const target = path.resolve(runDir, relative);
  // A link inside the run directory that resolves outside it is outside too.
  let resolvedOutside = false;
  try { resolvedOutside = !isInside(fs.realpathSync(runDir), fs.realpathSync(target)); } catch { /* absent: the reader reports it missing */ }
  return path.isAbsolute(relative) || !isInside(runDir, target) || resolvedOutside ? undefined : target;
}

/** Verifies each evidence file a result cites: a relative path inside the run directory whose bytes have the recorded
 * SHA-256. Returns undefined checks when the list is not in the recognised shape. */
function pilotEvidence(runDir: string, value: unknown, at: string, read: (absolutePath: string) => Buffer):
  { checks?: PilotEvidenceCheck[]; problem?: string } {
  if (!Array.isArray(value)) return { problem: `${at} is not an array` };
  const checks: PilotEvidenceCheck[] = [];
  for (const [index, entry] of value.entries()) {
    const problem = membersProblem(entry, `${at}[${index}]`, ['path', 'sha256']);
    if (problem) return { problem };
    const { path: relative, sha256 } = entry as Record<string, unknown>;
    if (!isText(relative, 1024) || typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
      return { problem: `${at}[${index}] is not a path with a SHA-256 hex` };
    }
    const target = citedRunFile(runDir, relative);
    if (!target) {
      checks.push({ path: relative, sha256, status: 'outside' });
      continue;
    }
    let bytes: Buffer;
    try { bytes = read(target); } catch { checks.push({ path: relative, sha256, status: 'missing' }); continue; }
    const actual = hash(bytes);
    checks.push(actual === sha256 ? { path: relative, sha256, status: 'verified' } : { path: relative, sha256, status: 'mismatch', actualSha256: actual });
  }
  return { checks };
}

/** What a run directory kept beside a package must still show for one file a pilot row recorded (verify:package --run-dir):
 * the bytes of a verified file, the other bytes of a mismatched one, nothing readable where a file was missing, and a path
 * still outside the run directory. */
export type RecordedRunFile =
  | { path: string; state: 'bytes'; sha256: string }
  | { path: string; state: 'absent' }
  | { path: string; state: 'outside' };

/** The recorded state of one evidence check, read as pilotEvidence wrote it; a problem when the entry is not such a check. */
function recordedCheck(entry: unknown, at: string): RecordedRunFile | { problem: string } {
  if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string'
    || !(PILOT_EVIDENCE_STATUSES as readonly unknown[]).includes(entry.status)) {
    return { problem: `${at} is not an evidence check with a path, a SHA-256 and one of the statuses ${PILOT_EVIDENCE_STATUSES.join(', ')}` };
  }
  switch (entry.status as PilotEvidenceStatus) {
    case 'verified': return { path: entry.path, state: 'bytes', sha256: entry.sha256 };
    case 'mismatch': return typeof entry.actualSha256 === 'string'
      ? { path: entry.path, state: 'bytes', sha256: entry.actualSha256 } : { problem: `${at} is a mismatch without the SHA-256 found` };
    case 'missing': return { path: entry.path, state: 'absent' };
    case 'outside': return { path: entry.path, state: 'outside' };
  }
}

/** Every run file a pilot row recorded, with the state the run directory must still show: each evidence check of the case
 * or of a control's systems, each key set file check a key set refusal recorded (keySetFiles), and the key set manifest and
 * seal record only when the row holds the sealed key set read from them. The summary's own claims (keySet) are never
 * re-hashed on their own: a claim the import refused is recorded by its check. */
export function pilotRowRunFiles(body: Record<string, unknown>): { files: RecordedRunFile[]; problems: string[] } {
  const files: RecordedRunFile[] = [], problems: string[] = [];
  const read = (list: unknown, at: string) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) { problems.push(`${at} is not a list of evidence checks`); return; }
    for (const [index, entry] of list.entries()) {
      const recorded = recordedCheck(entry, `${at}[${index}]`);
      if ('problem' in recorded) problems.push(recorded.problem); else files.push(recorded);
    }
  };
  read(body.evidence, 'evidence');
  if (Array.isArray(body.systems)) for (const [index, system] of body.systems.entries()) if (isRecord(system)) read(system.evidence, `systems[${index}].evidence`);
  read(body.keySetFiles, 'keySetFiles');
  if (body.sealedKeySet !== undefined) {
    const keySet = isRecord(body.keySet) ? body.keySet : {};
    for (const member of ['manifest', 'seal']) {
      const file = keySet[member];
      if (isRecord(file) && typeof file.path === 'string' && typeof file.sha256 === 'string') files.push({ path: file.path, state: 'bytes', sha256: file.sha256 });
      else problems.push(`the row holds sealedKeySet but keySet.${member} is not a path with a SHA-256`);
    }
  }
  return { files, problems };
}

/** The refusal an evidence list gives, the worst first; undefined when every file verified. */
function evidenceFailure(checks: readonly PilotEvidenceCheck[], at: string): CaseOutcome | undefined {
  const named = (status: PilotEvidenceCheck['status']) => checks.filter(check => check.status === status).map(check => check.path);
  const body = { evidence: checks };
  if (named('outside').length) return caseFail('EVIDENCE_PATH_OUTSIDE_RUN', `${at} cites files outside the run directory: ${named('outside').join(', ')}.`, body);
  if (named('mismatch').length) return caseFail('EVIDENCE_HASH_MISMATCH', `${at} cites files whose bytes differ from the recorded SHA-256: ${named('mismatch').join(', ')}.`, body);
  if (named('missing').length) return caseFail('EVIDENCE_MISSING', `${at} cites files the run directory lacks: ${named('missing').join(', ')}.`, body);
  return undefined;
}

/** What the sealed key set's own bytes state (D-LE-21): identifiers, the seal time, N, the held case ids and which cases are
 * countersigned. Only these are read and recorded; no key file is opened, so no gold enters the framework. */
interface SealedKeySet {
  keySetId: string;
  manifestSha256: string;
  sealedAt: string;
  criticalInstancesDeclared: number;
  /** The case ids the manifest's coverage still holds (coverage.held[].case). */
  held: string[];
  /** The cases adjudication.countersignatures names, each with who countersigned, in what role and when. */
  countersignedCases: string[];
}

/** Reads the key set a run states from the two files it cites, the sealed manifest and the seal record (the key set's
 * root COMPLETE marker), both inside the run directory with the recorded SHA-256. A cited file that is absent or outside
 * the run records KEY_MANIFEST_MISSING; bytes or facts that differ from what the summary states record KEY_MANIFEST_MISMATCH. */
function sealedKeySetOf(run: PilotRunBlock, runDir: string, read: (absolutePath: string) => Buffer): { sealed?: SealedKeySet; failure?: CaseOutcome } {
  const { manifest: manifestFile, seal: sealFile } = run.keySet;
  const checks = pilotEvidence(runDir, [manifestFile, sealFile], 'pilot.keySet', read).checks ?? [];
  const body = { keySetFiles: checks };
  const named = (...statuses: PilotEvidenceCheck['status'][]) => checks.filter(check => statuses.includes(check.status)).map(check => check.path);
  if (named('missing', 'outside').length) {
    return { failure: caseFail('KEY_MANIFEST_MISSING', `The run cites a key set manifest or seal record it does not hold inside the run directory: ${named('missing', 'outside').join(', ')}.`, body) };
  }
  if (named('mismatch').length) {
    return { failure: caseFail('KEY_MANIFEST_MISMATCH', `The key set files differ from the SHA-256 the summary records: ${named('mismatch').join(', ')}.`, body) };
  }
  const parsed = (file: { path: string }): Record<string, unknown> | undefined => {
    try {
      const value: unknown = JSON.parse(read(path.resolve(runDir, file.path)).toString('utf8').replace(/^\uFEFF/, ''));
      return isRecord(value) ? value : undefined;
    } catch { return undefined; }
  };
  const manifest = parsed(manifestFile), seal = parsed(sealFile);
  if (!manifest || !seal) return { failure: caseFail('KEY_MANIFEST_MISMATCH', 'The key set manifest or seal record is not a JSON object.', body) };
  const bare = (value: unknown) => (typeof value === 'string' ? value.replace(/^sha256:/, '') : '');
  const stated = run.keySet;
  const coverage = isRecord(manifest.coverage) ? manifest.coverage : undefined;
  const adjudication = isRecord(manifest.adjudication) ? manifest.adjudication : undefined;
  const held = Array.isArray(coverage?.held) ? coverage.held : undefined;
  const countersignatures = Array.isArray(adjudication?.countersignatures) ? adjudication.countersignatures : undefined;
  const gaps = [
    ...(seal.status === 'COMPLETE' ? [] : ['the seal record is not status COMPLETE']),
    ...(seal.keySetId === stated.keySetId ? [] : [`the seal record names key set ${JSON.stringify(seal.keySetId)}`]),
    ...(manifest.keySetId === stated.keySetId ? [] : [`the manifest names key set ${JSON.stringify(manifest.keySetId)}`]),
    ...(bare(seal.manifestSha256) === manifestFile.sha256 ? [] : ['the seal record names another manifest']),
    ...(isInstant(seal.sealedAt) && Date.parse(seal.sealedAt) === Date.parse(stated.sealedAt) ? [] : [`the seal record states sealedAt ${JSON.stringify(seal.sealedAt)}`]),
    ...(manifest.study === PILOT_STUDY ? [] : [`the manifest names study ${JSON.stringify(manifest.study)}`]),
    ...(isCount(manifest.criticalInstancesDeclared) ? [] : ['the manifest declares no criticalInstancesDeclared']),
    ...(isCount(manifest.criticalInstancesDeclared) && manifest.criticalInstancesDeclared !== stated.criticalInstancesDeclared
      ? [`the manifest declares ${manifest.criticalInstancesDeclared} critical instances`] : []),
    ...(held?.every(entry => isRecord(entry) && isText(entry.case, 64)) ? [] : ['the manifest has no coverage.held list of case ids']),
    ...(countersignatures?.every(entry => isRecord(entry) && isText(entry.case, 64) && isText(entry.by, 200) && isText(entry.role, 200) && isInstant(entry.at))
      ? [] : ['the manifest has no adjudication.countersignatures list of case, by, role and at']),
  ];
  if (gaps.length) return { failure: caseFail('KEY_MANIFEST_MISMATCH', `The sealed key set does not say what the summary states: ${gaps.join('; ')}.`, { ...body, problems: gaps }) };
  return { sealed: {
    keySetId: stated.keySetId, manifestSha256: manifestFile.sha256, sealedAt: seal.sealedAt as string, criticalInstancesDeclared: manifest.criticalInstancesDeclared as number,
    held: (held as Record<string, unknown>[]).map(entry => entry.case as string),
    countersignedCases: (countersignatures as Record<string, unknown>[]).map(entry => entry.case as string),
  } };
}

/** Whether the sealed key set holds an acceptance case: its id, or a part of it (A13-overlay holds A13). */
const keySetHolds = (sealed: SealedKeySet, acceptanceCase: string) => sealed.held.some(id => id === acceptanceCase || id.startsWith(`${acceptanceCase}-`));

/** One acceptance case's result as admitted, or not executed (`executed: false`) when the run did not run or report it. */
interface PilotCaseOutcome { executed: boolean; outcome: CaseOutcome; criticalInstances?: number; criticalFailures?: number }

function acceptanceOutcome(pqCase: Ta3PqCase, run: PilotRunBlock, keys: ReturnType<typeof sealedKeySetOf>, runDir: string, read: (absolutePath: string) => Buffer, publicData?: PublicDataAdmission): PilotCaseOutcome {
  const at = `pilot.cases ${pqCase.acceptanceCase}`;
  const result = run.cases.find(entry => entry.case === pqCase.acceptanceCase);
  if (!result) {
    return { executed: false, outcome: caseFail('CASE_NOT_REPORTED', `The run reports no result for ${pqCase.acceptanceCase}; nothing is admitted.`) };
  }
  const shape = membersProblem(result, at, PILOT_CASE_MEMBERS, ['reason']);
  if (shape) return { executed: true, outcome: unsupportedPilot([shape]) };
  const problems: string[] = [];
  if (typeof result.requirement !== 'string') problems.push(`${at}.requirement is not text`);
  if (!PILOT_VERDICTS.includes(String(result.verdict))) problems.push(`${at}.verdict is ${JSON.stringify(result.verdict)}`);
  if (!PILOT_COVERAGE.includes(String(result.coverage))) problems.push(`${at}.coverage is ${JSON.stringify(result.coverage)}`);
  if (!PILOT_KEY_BASES.includes(String(result.keyBasis))) problems.push(`${at}.keyBasis is ${JSON.stringify(result.keyBasis)}`);
  if (!isCount(result.scoredInstances) || !isCount(result.criticalInstances) || !isCount(result.criticalFailures)) {
    problems.push(`${at}: scoredInstances, criticalInstances and criticalFailures are not counts`);
  } else if ((result.criticalFailures as number) > (result.criticalInstances as number) || (result.criticalInstances as number) > (result.scoredInstances as number)) {
    problems.push(`${at}: criticalFailures ${result.criticalFailures}, criticalInstances ${result.criticalInstances} and scoredInstances ${result.scoredInstances} are not nested`);
  }
  if (result.reason !== undefined && !isText(result.reason)) problems.push(`${at}.reason is not text`);
  const evidence = pilotEvidence(runDir, result.evidence, `${at}.evidence`, read);
  if (evidence.problem) problems.push(evidence.problem);
  if (problems.length) return { executed: true, outcome: unsupportedPilot(problems) };
  const counts = { scoredInstances: result.scoredInstances, criticalInstances: result.criticalInstances, criticalFailures: result.criticalFailures };
  const body = {
    case: pqCase.acceptanceCase, requirement: result.requirement, verdict: result.verdict, coverage: result.coverage, keyBasis: result.keyBasis,
    ...counts, evidence: evidence.checks, ...(result.reason !== undefined ? { reason: result.reason } : {}),
  };
  const tally = { criticalInstances: result.criticalInstances as number, criticalFailures: result.criticalFailures as number };
  const decided = (outcome: CaseOutcome, executed = true): PilotCaseOutcome => ({ executed, outcome: { ...outcome, body: { ...body, ...outcome.body } }, ...tally });
  if (result.requirement !== pqCase.requirement) {
    return decided(caseFail('REQUIREMENT_MISMATCH', `${pqCase.acceptanceCase} names requirement ${result.requirement}; the catalog names ${pqCase.requirement}.`));
  }
  const classification = classificationFailure(run, publicData);
  if (classification) return decided(classification);
  if (!keys.sealed) return decided(keys.failure!);
  if (Date.parse(keys.sealed.sealedAt) >= Date.parse(run.startedAt)) {
    return decided(caseFail('KEY_NOT_SEALED_BEFORE_RUN', `The answer key ${keys.sealed.keySetId} was sealed at ${keys.sealed.sealedAt}, not before the run started at ${run.startedAt}.`));
  }
  if (result.verdict === 'not-run') return decided(caseFail('CASE_NOT_RUN', `The run did not run ${pqCase.acceptanceCase}${result.reason ? `: ${result.reason}` : ''}.`), false);
  const evidenceRefusal = evidenceFailure(evidence.checks!, at);
  if (evidenceRefusal) return decided(evidenceRefusal);
  if (result.verdict === 'fail' || (result.criticalFailures as number) > 0) {
    return decided(caseFail(pqCase.failureCode ?? 'CASE_FAILED', `${pqCase.acceptanceCase} failed in the run (verdict ${result.verdict}, ${result.criticalFailures} critical failure(s))${result.reason ? `: ${result.reason}` : ''}.`));
  }
  if (result.verdict === 'inconclusive' || result.coverage !== 'complete' || (result.scoredInstances as number) < 1 || !evidence.checks!.length) {
    return decided(caseFail('INCONCLUSIVE', `${pqCase.acceptanceCase} is inconclusive (verdict ${result.verdict}, coverage ${result.coverage}, `
      + `${result.scoredInstances} scored instance(s), ${evidence.checks!.length} evidence file(s)); an inconclusive result never passes.`));
  }
  if (keySetHolds(keys.sealed, pqCase.acceptanceCase!)) {
    return decided(caseFail('KEY_CASE_HELD', `The sealed key set ${keys.sealed.keySetId} still holds ${pqCase.acceptanceCase} (coverage.held), so a pass has no key to rest on.`));
  }
  if (run.runKind === 'R2' && result.keyBasis !== 'countersigned') {
    return decided(caseFail('KEY_NOT_COUNTERSIGNED', `The R2 key of ${pqCase.acceptanceCase} is ${result.keyBasis}; the run of record needs a countersigned key (D-LE-21).`));
  }
  if (run.runKind === 'R2' && !keys.sealed.countersignedCases.includes(pqCase.acceptanceCase!)) {
    return decided(caseFail('KEY_NOT_COUNTERSIGNED', `The summary says the R2 key of ${pqCase.acceptanceCase} is countersigned; the sealed manifest records no countersignature for it (D-LE-21).`));
  }
  const keyNote = result.keyBasis === 'countersigned' ? 'its key countersigned' : `its key ${result.keyBasis}, admitted for R1 only (D-LE-21)`;
  return decided(casePass(`${pqCase.acceptanceCase} passed in the ${run.runKind} run with ${result.scoredInstances} scored instance(s), `
    + `${result.criticalInstances} critical and none failed, ${evidence.checks!.length} evidence file(s) verified, ${keyNote}.`, {}));
}

const unsupportedPilot = (problems: string[], body: Record<string, unknown> = {}): CaseOutcome =>
  caseFail(UNSUPPORTED_PILOT_SUMMARY, `The pilot summary is not in a shape the import recognises: ${problems.join('; ')}.`, { ...body, problems });

/** PQA-021, the G3 bound, from the admitted A1 to A20 outcomes. */
function criticalBoundOutcome(run: PilotRunBlock, outcomes: ReadonlyMap<string, PilotCaseOutcome>): PilotCaseOutcome {
  const acceptance = PILOT_PQ_CASES.filter(entry => /^A\d+$/.test(entry.acceptanceCase ?? ''));
  const notRun = acceptance.filter(entry => !outcomes.get(entry.id)!.executed).map(entry => entry.acceptanceCase);
  const declared = run.keySet.criticalInstancesDeclared;
  if (notRun.length) {
    return { executed: false, outcome: caseFail('CASES_NOT_RUN', `G3 needs every acceptance case executed; not executed: ${notRun.join(', ')}.`, { notRun, declared }) };
  }
  const notPassed = acceptance.filter(entry => !outcomes.get(entry.id)!.outcome.passed).map(entry => entry.acceptanceCase);
  const instances = acceptance.reduce((sum, entry) => sum + (outcomes.get(entry.id)!.criticalInstances ?? 0), 0);
  const failures = acceptance.reduce((sum, entry) => sum + (outcomes.get(entry.id)!.criticalFailures ?? 0), 0);
  const body = { declared, criticalInstances: instances, criticalFailures: failures, upperBound95: instances > 0 ? 3 / instances : null, notPassed };
  const gaps = [
    ...(notPassed.length ? [`acceptance cases not passed: ${notPassed.join(', ')}`] : []),
    ...(instances !== declared ? [`the cases' ${instances} critical instances differ from the ${declared} the sealed key declares`] : []),
    ...(declared < PILOT_MIN_CRITICAL_INSTANCES ? [`the key declares ${declared} critical instances, fewer than ${PILOT_MIN_CRITICAL_INSTANCES}`] : []),
    ...(failures > 0 ? [`${failures} critical failure(s)`] : []),
  ];
  if (gaps.length) return { executed: true, outcome: caseFail('CRITICAL_FAILURE_BOUND_NOT_MET', `G3 is not met: ${gaps.join('; ')}.`, body) };
  return { executed: true, outcome: casePass(`G3 holds: zero critical failures in ${instances} scored critical instances; 95% upper bound ${(3 / instances).toFixed(4)} (3/N).`, body) };
}

/** Why one system's control counts break the control's rule ('fail'), cannot show it ('inconclusive'), or are not
 * recognised ('unsupported'); undefined when the system passes. */
function controlSystemVerdict(control: PilotControl, counts: Record<string, unknown>, run: PilotRunBlock):
  { kind: 'fail' | 'inconclusive' | 'unsupported'; detail: string } | undefined {
  const allCounts = (...keys: string[]) => keys.every(key => isCount(counts[key]));
  switch (control) {
    case 'security': {
      if (!allCounts('probes', 'refusedAsExpected', 'unexpectedAcceptances')) return { kind: 'unsupported', detail: 'probe counts are not counts' };
      const { probes, refusedAsExpected, unexpectedAcceptances } = counts as Record<string, number>;
      if (refusedAsExpected + unexpectedAcceptances !== probes) return { kind: 'unsupported', detail: `refused ${refusedAsExpected} and accepted ${unexpectedAcceptances} do not add up to ${probes} probes` };
      if (unexpectedAcceptances > 0) return { kind: 'fail', detail: `${unexpectedAcceptances} of ${probes} probes were accepted` };
      if (probes < 1) return { kind: 'inconclusive', detail: 'no probe was run' };
      return undefined;
    }
    case 'backup-restore': {
      if (typeof counts.backupTaken !== 'boolean' || typeof counts.restoredIsolated !== 'boolean'
        || typeof counts.sourceDigest !== 'string' || !SHA256_HEX.test(counts.sourceDigest)
        || typeof counts.restoredDigest !== 'string' || !SHA256_HEX.test(counts.restoredDigest)
        || !allCounts('recoveryPointSeconds', 'recoveryTimeSeconds')) {
        return { kind: 'unsupported', detail: 'backupTaken and restoredIsolated are not booleans, a digest is not a SHA-256 hex, or a recovery time is not a count' };
      }
      if (!counts.backupTaken || !counts.restoredIsolated) return { kind: 'inconclusive', detail: 'no backup was restored into an isolated target' };
      if (counts.sourceDigest !== counts.restoredDigest) return { kind: 'fail', detail: `restored digest ${counts.restoredDigest} differs from source ${counts.sourceDigest}` };
      return undefined;
    }
    case 'signature-linking': {
      if (!allCounts('signatures', 'linked', 'digestRecomputedEqual', 'unlinked', 'mismatched')) return { kind: 'unsupported', detail: 'signature counts are not counts' };
      const { signatures, linked, digestRecomputedEqual, unlinked, mismatched } = counts as Record<string, number>;
      if (linked + unlinked !== signatures || digestRecomputedEqual + mismatched !== linked) {
        return { kind: 'unsupported', detail: `linked ${linked} plus unlinked ${unlinked} is not ${signatures}, or recomputed ${digestRecomputedEqual} plus mismatched ${mismatched} is not ${linked}` };
      }
      if (unlinked > 0 || mismatched > 0) return { kind: 'fail', detail: `${unlinked} unlinked and ${mismatched} mismatched of ${signatures} signatures` };
      if (signatures < 1) return { kind: 'inconclusive', detail: 'no signature was produced, so linking cannot be shown' };
      return undefined;
    }
    case 'access-census': {
      if (!allCounts('accessEvents', 'accountChangeEvents', 'accountsDeclared', 'accountsFound', 'accountsUndeclared') || !isInstant(counts.windowStart)) {
        return { kind: 'unsupported', detail: 'census counts are not counts or windowStart is not an RFC 3339 instant' };
      }
      const { accessEvents, accountChangeEvents, accountsDeclared, accountsFound, accountsUndeclared } = counts as Record<string, number>;
      // Both directions: every declared account appears, and nothing in the logs is outside the declared set.
      const gaps = [
        ...(accountsUndeclared > 0 ? [`${accountsUndeclared} account(s) in the logs that were never declared`] : []),
        ...(accountsFound > accountsDeclared ? [`${accountsFound} accounts found against ${accountsDeclared} declared`] : []),
        ...(accessEvents < 1 ? ['no access event'] : []),
        ...(accountChangeEvents < 1 ? ['no account-change event'] : []),
        ...(accountsDeclared < 1 ? ['no declared account'] : []),
        ...(accountsFound < accountsDeclared ? [`${accountsDeclared - accountsFound} declared account(s) missing from the account-change log`] : []),
        ...(Date.parse(counts.windowStart as string) > Date.parse(run.startedAt) ? [`the log window starts at ${counts.windowStart}, after the run start`] : []),
      ];
      return gaps.length ? { kind: 'fail', detail: gaps.join(', ') } : undefined;
    }
  }
}

/** PQC-001 to PQC-004: one control's per-system results. */
function controlOutcome(pqCase: Ta3PqCase, run: PilotRunBlock, runDir: string, read: (absolutePath: string) => Buffer, publicData?: PublicDataAdmission): PilotCaseOutcome {
  const control = pqCase.acceptanceCase as PilotControl;
  const at = `pilot.controls ${control}`;
  const entry = run.controls.find(candidate => candidate.control === control);
  if (!entry) return { executed: false, outcome: caseFail('CONTROL_NOT_REPORTED', `The run reports no ${control} result; nothing is admitted.`) };
  const shape = membersProblem(entry, at, PILOT_CONTROL_MEMBERS);
  if (shape) return { executed: true, outcome: unsupportedPilot([shape]) };
  if (!Array.isArray(entry.systems)) return { executed: true, outcome: unsupportedPilot([`${at}.systems is not an array`]) };
  const problems: string[] = [], systems: Record<string, unknown>[] = [], seen = new Set<string>();
  const evidenceChecks: PilotEvidenceCheck[] = [];
  const verdicts: { system: string; kind: 'fail' | 'inconclusive' | 'pass'; detail: string }[] = [];
  for (const [index, system] of entry.systems.entries()) {
    const where = `${at}.systems[${index}]`;
    const systemShape = membersProblem(system, where, ['system', 'counts', 'evidence']);
    if (systemShape) { problems.push(systemShape); continue; }
    const { system: name, counts, evidence } = system as Record<string, unknown>;
    if (typeof name !== 'string' || !(PILOT_CONTROL_SYSTEMS as readonly string[]).includes(name)) { problems.push(`${where}.system is ${JSON.stringify(name)}`); continue; }
    if (seen.has(name)) { problems.push(`${at} repeats ${name}`); continue; }
    seen.add(name);
    const countsShape = membersProblem(counts, `${where}.counts`, PILOT_CONTROL_COUNTS[control]);
    if (countsShape) { problems.push(countsShape); continue; }
    const checked = pilotEvidence(runDir, evidence, `${where}.evidence`, read);
    if (checked.problem) { problems.push(checked.problem); continue; }
    evidenceChecks.push(...checked.checks!);
    const verdict = controlSystemVerdict(control, counts as Record<string, unknown>, run);
    if (verdict?.kind === 'unsupported') { problems.push(`${where}: ${verdict.detail}`); continue; }
    if (!checked.checks!.length && !verdict) verdicts.push({ system: name, kind: 'inconclusive', detail: 'no evidence file' });
    else verdicts.push({ system: name, kind: verdict?.kind ?? 'pass', detail: verdict?.detail ?? 'passed' });
    systems.push({ system: name, counts, evidence: checked.checks });
  }
  if (problems.length) return { executed: true, outcome: unsupportedPilot(problems) };
  const body = { control, requirement: entry.requirement, systems };
  const decided = (outcome: CaseOutcome): PilotCaseOutcome => ({ executed: true, outcome: { ...outcome, body: { ...body, ...outcome.body } } });
  if (entry.requirement !== pqCase.requirement) {
    return decided(caseFail('REQUIREMENT_MISMATCH', `The ${control} result names requirement ${String(entry.requirement)}; the catalog names ${pqCase.requirement}.`));
  }
  const classification = classificationFailure(run, publicData);
  if (classification) return decided(classification);
  const evidenceRefusal = evidenceFailure(evidenceChecks, at);
  if (evidenceRefusal) return decided({ ...evidenceRefusal, body: {} });
  const failed = verdicts.filter(item => item.kind === 'fail');
  if (failed.length) return decided(caseFail(pqCase.failureCode!, `${control} failed: ${failed.map(item => `${item.system} (${item.detail})`).join('; ')}.`));
  const missing = PILOT_CONTROL_SYSTEMS.filter(name => !seen.has(name));
  const inconclusive = verdicts.filter(item => item.kind === 'inconclusive');
  if (missing.length || inconclusive.length) {
    return decided(caseFail('INCONCLUSIVE', `${control} is inconclusive: ${[...missing.map(name => `${name} not reported`),
      ...inconclusive.map(item => `${item.system} (${item.detail})`)].join('; ')}; an inconclusive control never passes.`, { missingSystems: missing }));
  }
  return decided(casePass(`${control} passed for ${PILOT_CONTROL_SYSTEMS.join(', ')}, each with its evidence verified.`, {}));
}

/** PQA-001 to PQA-021 and PQC-001 to PQC-004 of a pilot run (LE-7.2), derived from the reconstructed summary without
 * re-scoring. It reads only the evidence files the summary cites, through `readEvidence`, and no clock or process.
 * Without a reconstruction every case is not executed (RECONSTRUCTION_FAILED); a summary the import does not
 * recognise records UNSUPPORTED_PILOT_SUMMARY on every case, never a guess; a case the run did not run or report is
 * recorded not executed, so an R1 at the Stage B exit shows its Stage C cases not executed, never failed. */
export function derivePilotResults(input: PilotDerivationInput): EvidenceResult[] {
  const read = input.readEvidence ?? ((absolutePath: string) => fs.readFileSync(absolutePath));
  const identity = { summaryContract: PILOT_ACCEPTANCE_CONTRACT, summarySha256: input.summarySha256, metricsSha256: input.metricsSha256 };
  const row = (pqCase: Ta3PqCase, executed: boolean, outcome: CaseOutcome, runBody: Record<string, unknown>): EvidenceResult => ({
    testCaseId: pqCase.id, timestamp: input.timestamp, endpoint: input.runDir, method: executed ? 'OFFLINE' : 'CONTRACT', responseStatus: 0,
    responseBody: { ...identity, ...runBody, ...outcome.body }, passed: outcome.passed,
    notes: `${executed ? '' : 'Not executed: '}${outcome.detail} ${PILOT_SCOPE}`,
    ...(outcome.code ? { outcomeCode: outcome.code } : {}),
    regulatoryRef: ta3RegulatoryRef(pqCase), testDescription: `${pqCase.acceptanceCase}: ${pqCase.title}`, acceptanceCriteria: pqCase.passesWhen,
  });
  const summary = input.summary;
  if (!summary) {
    return PILOT_PQ_CASES.map(pqCase => row(pqCase, false, caseFail('RECONSTRUCTION_FAILED',
      `the run did not reconstruct (${input.reconstructionError ?? 'no reconstruction'}), so no pilot result is admitted.`), {}));
  }
  const { run, problems } = pilotRunBlock(summary);
  if (!run) return PILOT_PQ_CASES.map(pqCase => row(pqCase, true, unsupportedPilot(problems), {}));
  const keys = sealedKeySetOf(run, input.runDir, read);
  const runBody = { runKind: run.runKind, startedAt: run.startedAt, classification: run.classification, keySet: run.keySet,
    ...(keys.sealed ? { sealedKeySet: keys.sealed } : {}), nonClaims: run.nonClaims ?? [] };
  const outcomes = new Map<string, PilotCaseOutcome>();
  for (const pqCase of PILOT_PQ_CASES) {
    if (/^A\d+$/.test(pqCase.acceptanceCase ?? '')) outcomes.set(pqCase.id, acceptanceOutcome(pqCase, run, keys, input.runDir, read, input.publicData));
    else if (pqCase.acceptanceCase !== 'G3') outcomes.set(pqCase.id, controlOutcome(pqCase, run, input.runDir, read, input.publicData));
  }
  const bound = PILOT_PQ_CASES.find(entry => entry.acceptanceCase === 'G3')!;
  outcomes.set(bound.id, criticalBoundOutcome(run, outcomes));
  return PILOT_PQ_CASES.map(pqCase => {
    const decided = outcomes.get(pqCase.id)!;
    return row(pqCase, decided.executed, decided.outcome, runBody);
  });
}
