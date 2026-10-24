import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import {
  defaultPlatformRoot, resolveFrontendRoot, resolveInteropMiddlewareRoot, resolveLibreclinicaApiRoot,
  resolvePlatformRepository, resolveSharedTypesRoot, resolveTrainingModuleRoot,
} from '../collectors/workspace-paths';
import {
  EDC_WORKSPACE_CANDIDATES, PENDING_VALIDATED_CHANGES, PLATFORM_INVENTORY_VERSION, PLATFORM_SYSTEMS,
  type EdcWorkspaceResolver, type GapProbe, type PlatformSystem, type StatementLocator,
} from '../config/platform-inventory';
import { OQ_SUITES, oqSuiteCaseIds } from '../config/oq-case-registry';
import { ICH_E6_R3, E6_R3_SECTION_STATUS, e6r3 } from '../config/regulatory-scope';
import { RELEASE_PQ_CASE } from '../config/ta3-pq-cases';
import { checkPlatformEvidencePlan, PLATFORM_EVIDENCE_STATUSES, type CheckedPlatformEvidence, type PlatformEvidenceStatus } from '../runners/evidence-package';
import { currentEvidenceMarking, isRecord, DEVELOPMENT_RUN_NOTICE, SYNTHETIC_NOTICE } from '../runners/evidence-capture';
import { frameworkCommit, parseReleaseComponent, type ReleaseComponent } from '../runners/release-identity';
import { dotenvEnvironment, sourceFlagValue, type FlagValue } from '../runners/target-configuration';
import { approvalBlock, documentHeader, hr, markdownTable, section } from './helpers/markdown-writer';

// The platform validation summary (TA3 plan VAL-1, spec P20 3.7, VD-7 and VD-10;
// document 22). For every system of config/platform-inventory.ts it records the
// repository's HEAD and whether tracked files differ from it, quotes the line that
// states the system's qualification status from the current bytes with the file's
// SHA-256 and line number, evaluates the gap probes, and shows the evidence a
// platform-validation-evidence-plan/1 (--platform-evidence) cites, each entry checked
// by hash through runners/evidence-package.ts. It compares the EDC API release of a
// cited OQ package with the release a cited O-7 import recorded, and lists the
// validated changes that wait for change control. It writes
// 22-platform-validation-summary.md and platform-validation-summary.json
// (contracts/platform-validation-summary-v1.schema.json). Data, not verdicts: no
// status is ever "qualified", and the JSON holds no subject, site or arm data.
// Repositories are only read: git rev-parse and git status, never a write.

export const PLATFORM_SUMMARY_CONTRACT = 'platform-validation-summary/1';
export const PLATFORM_SUMMARY_DOCUMENT = '22-platform-validation-summary.md';
export const PLATFORM_SUMMARY_FILE = 'platform-validation-summary.json';

/** Required members of the summary and of its objects; the contract test compares them with the schema. */
export const PLATFORM_SUMMARY_REQUIRED = [
  'contract', 'generatedAt', 'framework', 'inventoryVersion', 'platformRoot', 'evidencePlan', 'e6r3', 'systems',
  'releaseConsistency', 'pendingValidatedChanges',
] as const;
/** Present only when the run is marked (a synthetic or a development run), as on every evidence summary. */
export const PLATFORM_SUMMARY_OPTIONAL = ['synthetic', 'syntheticNotice', 'retention'] as const;
export const PLATFORM_SUMMARY_MEMBERS = {
  framework: { required: ['commit', 'dirty'], optional: [] },
  evidencePlan: { required: ['path', 'sha256', 'preparedBy'], optional: [] },
  e6r3: { required: ['citation', 'sectionVerification', 'sectionStatus'], optional: [] },
  system: { required: ['id', 'name', 'repo', 'head', 'dirty', 'ta3Uses', 'statement', 'evidenceAdmitted', 'evidence', 'gaps', 'status'], optional: [] },
  quotedLine: { required: ['file', 'line', 'text', 'fileSha256'], optional: [] },
  evidence: { required: ['kind', 'path', 'sha256', 'synthetic', 'status', 'detail'], optional: ['note'] },
  gap: { required: ['id', 'text', 'item', 'probe'], optional: [] },
  probe: { required: ['file', 'rule', 'literal', 'status'], optional: ['line'] },
  releaseConsistency: { required: ['status', 'detail', 'oq', 'o7'], optional: [] },
  releaseSide: { required: ['path', 'manifestSha256', 'api', 'detail'], optional: [] },
  pendingChange: {
    required: ['id', 'decision', 'change', 'system', 'flags', 'oqCases', 'oqEvidence', 'category', 'status', 'statusText'], optional: [],
  },
  changeFlag: { required: ['flag', 'file', 'fileSha256', 'line', 'value'], optional: [] },
  oqEvidence: { required: ['path', 'manifestSha256', 'synthetic', 'api', 'passed', 'notPassed', 'notRecorded'], optional: [] },
  category: { required: ['name', 'reason', 'sop'], optional: [] },
} as const;

/** The two statuses a system can have; neither is a verdict, and "qualified" is never one. */
export const SYSTEM_STATUSES = ['evidence-present-unapproved', 'gap'] as const;
export type SystemStatus = typeof SYSTEM_STATUSES[number];
export const PROBE_STATUSES = ['open', 'probe-not-matched', 'file-missing'] as const;
export type ProbeStatus = typeof PROBE_STATUSES[number];
export const RELEASE_CONSISTENCY_STATUSES = ['same', 'RELEASE_MISMATCH', 'not-comparable'] as const;
export type ReleaseConsistencyStatus = typeof RELEASE_CONSISTENCY_STATUSES[number];
/** The contract of the deviation detection runs the O-7 benchmark imports (spec P09 8.2) and the PQ case of an O-7
 * import that states the run's own EDC API release (spec P20 3.5), defined once with the PQ cases. */
export { DEVIATION_DETECTION_CONTRACT, RELEASE_PQ_CASE } from '../config/ta3-pq-cases';

export interface QuotedLine { file: string; line: number; text: string; fileSha256: string }
export type StatementResult = QuotedLine | { status: 'not-found'; detail: string } | { status: 'not-stated' };

export interface EvidenceRow {
  kind: string;
  path: string;
  sha256: string;
  synthetic: boolean;
  status: PlatformEvidenceStatus;
  detail: string;
  note?: string;
}

export interface ProbeResult { file: string; rule: GapProbe['rule']; literal: string; status: ProbeStatus; line?: number }
export interface GapRow { id: string; text: string; item: string; probe: ProbeResult | null }

export interface SystemRow {
  id: string;
  name: string;
  /** The repository's path under the platform root (posix), or null when it was not found. */
  repo: string | null;
  head: string | null;
  /** Whether tracked files differ from HEAD; null when the repository is not its own git checkout. */
  dirty: boolean | null;
  ta3Uses: string[];
  statement: StatementResult;
  evidenceAdmitted: string;
  evidence: EvidenceRow[];
  gaps: GapRow[];
  status: SystemStatus;
}

export interface ReleaseSide {
  /** The cited package directory. */
  path: string;
  manifestSha256: string;
  /** The EDC API release the side states, or null when it states none. */
  api: { kind: ReleaseComponent['kind']; identity: string } | null;
  detail: string;
}

export interface ReleaseConsistency {
  status: ReleaseConsistencyStatus;
  detail: string;
  /** Verified cited packages holding OQ evidence, with the API release they qualified. */
  oq: ReleaseSide[];
  /** Verified cited packages holding an O-7 import (benchmark evidence with a PQT-005 record). */
  o7: ReleaseSide[];
}

export interface ChangeFlagRow {
  flag: string;
  /** The production profile, posix path from the repository root. */
  file: string;
  fileSha256: string | null;
  /** The line that sets the flag, or null when the profile does not set it. */
  line: number | null;
  /** The setting as the EDC reads it (an unset flag reads as its default); null when the profile was not read. */
  value: FlagValue | null;
}

export interface OqEvidenceRow {
  path: string;
  manifestSha256: string;
  synthetic: boolean;
  api: string | null;
  passed: number;
  notPassed: number;
  notRecorded: number;
}

export interface PendingChangeRow {
  id: string;
  decision: string;
  change: string;
  system: string;
  flags: ChangeFlagRow[];
  oqCases: string[];
  oqEvidence: OqEvidenceRow[];
  category: { name: string; reason: string; sop: QuotedLine | { status: 'not-found'; detail: string } };
  status: 'no-change-control-record';
  statusText: string;
}

export interface PlatformValidationSummary {
  contract: typeof PLATFORM_SUMMARY_CONTRACT;
  generatedAt: string;
  framework: { commit: string | null; dirty: boolean | null };
  inventoryVersion: string;
  platformRoot: string;
  evidencePlan: { path: string; sha256: string; preparedBy: string } | null;
  e6r3: { citation: string; sectionVerification: typeof ICH_E6_R3.sectionVerification; sectionStatus: string };
  systems: SystemRow[];
  releaseConsistency: ReleaseConsistency;
  pendingValidatedChanges: PendingChangeRow[];
  synthetic?: true;
  syntheticNotice?: typeof SYNTHETIC_NOTICE;
  retention?: typeof DEVELOPMENT_RUN_NOTICE;
}

export interface PlatformSummaryOptions {
  /** --platform-root: the parent of the estate repositories; by default the parent of the EDC workspace. */
  platformRoot?: string;
  /** --platform-evidence, or the copy a retained package holds in inputs/. */
  platformEvidencePlan?: string;
  /** A fixed clock, for tests only. */
  now?: Date;
}

/** Repository files larger than this are not read. */
const FILE_BYTE_LIMIT = 64 * 1024 * 1024;
const GIT_COMMIT = /^[0-9a-f]{40}$/;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const posix = (relative: string) => relative.split(path.sep).join('/');

function isDirectory(directory: string): boolean {
  try { return fs.statSync(directory).isDirectory(); } catch { return false; }
}

const WORKSPACE_RESOLVERS: Record<EdcWorkspaceResolver, (workspace: string) => string | null> = {
  api: resolveLibreclinicaApiRoot,
  frontend: resolveFrontendRoot,
  training: resolveTrainingModuleRoot,
  interop: resolveInteropMiddlewareRoot,
  'shared-types': resolveSharedTypesRoot,
};

/** Every repository path comes from collectors/workspace-paths.ts; this module joins no repository name to a root. */
function locateRepository(system: PlatformSystem, platformRoot: string): string | null {
  const location = system.location;
  if ('platformCandidates' in location) return resolvePlatformRepository(platformRoot, location.platformCandidates);
  const workspace = resolvePlatformRepository(platformRoot, EDC_WORKSPACE_CANDIDATES);
  if (!workspace) return null;
  // The API and frontend resolvers name their current folder when none exists, so existence is checked here.
  const found = 'workspaceResolver' in location
    ? WORKSPACE_RESOLVERS[location.workspaceResolver](workspace)
    : resolvePlatformRepository(workspace, location.workspaceCandidates);
  return found && isDirectory(found) ? found : null;
}

/** HEAD and whether tracked files differ from it, read only; both null unless the directory is its own checkout. */
function gitState(repository: string): { head: string | null; dirty: boolean | null } {
  const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  try {
    const top = git('rev-parse', '--show-toplevel').trim();
    if (path.resolve(top).toLowerCase() !== path.resolve(repository).toLowerCase()) return { head: null, dirty: null };
    const head = git('rev-parse', 'HEAD').trim();
    if (!GIT_COMMIT.test(head)) return { head: null, dirty: null };
    return { head, dirty: git('status', '--porcelain', '--untracked-files=no').trim().length > 0 };
  } catch {
    return { head: null, dirty: null };
  }
}

interface RepositoryFile { bytes: Buffer; lines: string[] }

/** A repository file's current bytes and its lines; undefined when it is missing, too large or unreadable. */
function readRepositoryFile(repository: string, file: string): RepositoryFile | undefined {
  const full = path.join(repository, ...file.split('/'));
  try {
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > FILE_BYTE_LIMIT) return undefined;
    const bytes = fs.readFileSync(full);
    return { bytes, lines: bytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/) };
  } catch {
    return undefined;
  }
}

/** The first line holding the literal, quoted with the file's SHA-256 and its one-based line number. */
function quoteLine(repository: string | null, locator: StatementLocator): QuotedLine | { status: 'not-found'; detail: string } {
  if (!repository) return { status: 'not-found', detail: 'repository not found under the platform root' };
  const read = readRepositoryFile(repository, locator.file);
  if (!read) return { status: 'not-found', detail: `${locator.file} is missing: inventory stale` };
  const index = read.lines.findIndex(line => line.includes(locator.literal));
  if (index < 0) return { status: 'not-found', detail: `statement not found in ${locator.file}: inventory stale` };
  return { file: locator.file, line: index + 1, text: read.lines[index], fileSha256: sha256(read.bytes) };
}

/** contains: open while the literal is present; absent: open while it is absent; file-missing when the file cannot be read. */
export function evaluateProbe(repository: string | null, probe: GapProbe): ProbeResult {
  const read = repository ? readRepositoryFile(repository, probe.file) : undefined;
  if (!read) return { file: probe.file, rule: probe.rule, literal: probe.literal, status: 'file-missing' };
  const index = read.lines.findIndex(line => line.includes(probe.literal));
  const open = probe.rule === 'contains' ? index >= 0 : index < 0;
  return { file: probe.file, rule: probe.rule, literal: probe.literal, status: open ? 'open' : 'probe-not-matched', ...(index >= 0 ? { line: index + 1 } : {}) };
}

function evidenceRow(checked: CheckedPlatformEvidence): EvidenceRow {
  const { entry } = checked;
  return {
    kind: entry.kind, path: entry.path, sha256: entry.sha256, synthetic: checked.synthetic, status: checked.status, detail: checked.detail,
    ...(entry.note !== undefined ? { note: entry.note } : {}),
  };
}

/** One record of a verified package, read from its own file (the package is verified, so its bytes are the listed ones). */
function packageRecord(dir: string, category: string, testCaseId: string): Record<string, unknown> | undefined {
  try {
    const record: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'evidence', category, `${testCaseId}.json`), 'utf8'));
    return isRecord(record) && record.testCaseId === testCaseId && typeof record.passed === 'boolean' ? record : undefined;
  } catch {
    return undefined;
  }
}

type CitedPackage = NonNullable<CheckedPlatformEvidence['package']>;

/** Verified packages, once each, in plan order. */
function verifiedPackages(entries: readonly CheckedPlatformEvidence[]): CitedPackage[] {
  const seen = new Set<string>();
  const packages: CitedPackage[] = [];
  for (const entry of entries) {
    if (entry.status !== 'verified' || !entry.package || seen.has(entry.package.manifestSha256)) continue;
    seen.add(entry.package.manifestSha256);
    packages.push(entry.package);
  }
  return packages;
}

const holds = (cited: CitedPackage, category: string) => cited.manifest.categories.some(item => item.category === category);

/** The release a PQT-005 record of an O-7 import states: responseBody.release.api, a Git commit or an image ID
 * (VAL-1/validation-pq records it from the run's own release fields). */
export function recordedPqRelease(record: Record<string, unknown> | undefined): ReleaseSide['api'] {
  const release = record?.passed === true && isRecord(record.responseBody) && isRecord(record.responseBody.release)
    ? record.responseBody.release.api : undefined;
  if (typeof release !== 'string') return null;
  try {
    const component = parseReleaseComponent('api', release);
    return { kind: component.kind, identity: component.identity };
  } catch {
    return null;
  }
}

const apiText = (api: ReleaseSide['api']) => (api ? `${api.kind} ${api.identity}` : 'not recorded');

/** Spec P20 3.5, release consistency: the API release of each cited OQ package against the release each cited O-7
 * import recorded in PQT-005. It never rewrites PQT-005; a difference is a gap of the EDC API. */
export function releaseConsistency(entries: readonly CheckedPlatformEvidence[]): ReleaseConsistency {
  const packages = verifiedPackages(entries);
  const oq: ReleaseSide[] = packages.filter(cited => holds(cited, 'oq')).map(cited => {
    const api = cited.manifest.releaseUnderTest?.components.api;
    return {
      path: cited.dir, manifestSha256: cited.manifestSha256, api: api ? { kind: api.kind, identity: api.identity } : null,
      detail: api ? 'releaseUnderTest of the package manifest' : 'the package manifest records no release under test',
    };
  });
  const o7: ReleaseSide[] = packages.filter(cited => holds(cited, 'benchmark')).flatMap(cited => {
    const record = packageRecord(cited.dir, 'benchmark', RELEASE_PQ_CASE);
    if (!record) return [];
    const api = recordedPqRelease(record);
    return [{
      path: cited.dir, manifestSha256: cited.manifestSha256, api,
      detail: api ? `${RELEASE_PQ_CASE} states the run's EDC API release`
        : `${RELEASE_PQ_CASE} records no EDC API release (${typeof record.outcomeCode === 'string' ? record.outcomeCode : 'RELEASE_NOT_RECORDED'})`,
    }];
  });
  if (!oq.length || !o7.length) {
    const missing = [!oq.length && 'no verified package with OQ evidence', !o7.length && `no verified package with an O-7 import (benchmark evidence with a ${RELEASE_PQ_CASE} record)`]
      .filter(Boolean).join(' and ');
    return { status: 'not-comparable', detail: `The evidence plan cites ${missing}.`, oq, o7 };
  }
  const pairs = oq.flatMap(left => o7.map(right => ({ left, right })));
  const comparable = pairs.filter(({ left, right }) => left.api && right.api && left.api.kind === right.api.kind);
  const differing = comparable.filter(({ left, right }) => left.api!.identity !== right.api!.identity);
  if (differing.length) {
    return {
      status: 'RELEASE_MISMATCH', oq, o7,
      detail: differing.map(({ left, right }) => `OQ package ${left.manifestSha256.slice(0, 12)} qualified ${apiText(left.api)}, `
        + `the O-7 import ${right.manifestSha256.slice(0, 12)} recorded ${apiText(right.api)}`).join('; '),
    };
  }
  if (comparable.length) return { status: 'same', oq, o7, detail: `Every OQ package and O-7 import states the same EDC API release (${apiText(comparable[0].left.api)}).` };
  return { status: 'not-comparable', oq, o7, detail: 'A side states no EDC API release, or the two state it in different kinds (a Git commit against an image ID).' };
}

function pendingChange(change: typeof PENDING_VALIDATED_CHANGES[number], repository: (id: string) => string | null,
  entries: readonly CheckedPlatformEvidence[]): PendingChangeRow {
  const repo = repository(change.system);
  const profile = repo ? readRepositoryFile(repo, change.productionProfile) : undefined;
  const environment = profile ? dotenvEnvironment(profile.lines.join('\n')) : undefined;
  const oqCases = OQ_SUITES.filter(suite => change.oqSuites.includes(suite.suite)).flatMap(oqSuiteCaseIds);
  return {
    id: change.id, decision: change.decision, change: change.change, system: change.system,
    flags: change.flags.map(flag => ({
      flag, file: change.productionProfile, fileSha256: profile ? sha256(profile.bytes) : null,
      line: environment?.entries.get(flag)?.line ?? null,
      value: environment ? sourceFlagValue(environment, flag) ?? null : null,
    })),
    oqCases,
    // What a change-control record would cite: the cited OQ packages and how many of the needed cases passed there.
    oqEvidence: verifiedPackages(entries).filter(cited => holds(cited, 'oq')).map(cited => {
      const records = oqCases.map(id => packageRecord(cited.dir, 'oq', id));
      const api = cited.manifest.releaseUnderTest?.components.api;
      return {
        path: cited.dir, manifestSha256: cited.manifestSha256, synthetic: cited.manifest.synthetic, api: api ? apiText(api) : null,
        passed: records.filter(record => record?.passed === true).length,
        notPassed: records.filter(record => record?.passed === false).length,
        notRecorded: records.filter(record => !record).length,
      };
    }),
    category: { name: change.category.name, reason: change.category.reason, sop: quoteLine(repo, change.category.sop) },
    status: change.status, statusText: change.statusText,
  };
}

/** Builds the summary from the inventory, the repositories under the platform root and the checked evidence plan. */
export function buildPlatformSummary(workspaceRoot: string, options: PlatformSummaryOptions = {}): PlatformValidationSummary {
  const platformRoot = path.resolve(options.platformRoot ?? defaultPlatformRoot(workspaceRoot));
  if (!isDirectory(platformRoot)) throw new Error(`The platform root ${platformRoot} is not a directory; pass --platform-root <the parent of the estate repositories>.`);
  // A plan is checked here too, so a summary never shows an entry the plan check would refuse.
  const plan = options.platformEvidencePlan ? checkPlatformEvidencePlan(options.platformEvidencePlan) : undefined;
  const entries = plan?.entries ?? [];
  const inventory: readonly PlatformSystem[] = PLATFORM_SYSTEMS;
  const repositories = new Map(inventory.map(system => [system.id, locateRepository(system, platformRoot)]));
  const consistency = releaseConsistency(entries);
  const systems = inventory.map((system): SystemRow => {
    const repository = repositories.get(system.id) ?? null;
    const git = repository ? gitState(repository) : { head: null, dirty: null };
    const evidence = entries.filter(entry => entry.system === system.id).map(evidenceRow);
    const gaps: GapRow[] = system.gaps.map(gap => ({ id: gap.id, text: gap.text, item: gap.item, probe: gap.probe ? evaluateProbe(repository, gap.probe) : null }));
    if (system.id === 'edc-api' && consistency.status === 'RELEASE_MISMATCH') {
      gaps.push({ id: 'RELEASE_MISMATCH', item: 'VAL-1', probe: null, text: `The OQ package and the O-7 import qualified different EDC API releases: ${consistency.detail}` });
    }
    return {
      id: system.id, name: system.name, repo: repository ? posix(path.relative(platformRoot, repository)) : null, ...git,
      ta3Uses: [...system.ta3Uses],
      statement: system.statement ? quoteLine(repository, system.statement) : { status: 'not-stated' },
      evidenceAdmitted: system.evidence.description,
      evidence,
      gaps,
      status: evidence.some(row => row.status === 'verified' || row.status === 'hash-only') ? 'evidence-present-unapproved' : 'gap',
    };
  });
  const framework = frameworkCommit();
  const marking = currentEvidenceMarking();
  return {
    contract: PLATFORM_SUMMARY_CONTRACT,
    generatedAt: (options.now ?? new Date()).toISOString(),
    framework: { commit: framework.commit ?? null, dirty: framework.dirty ?? null },
    inventoryVersion: PLATFORM_INVENTORY_VERSION,
    platformRoot,
    evidencePlan: plan ? { path: plan.file, sha256: plan.sha256, preparedBy: plan.plan.preparedBy } : null,
    e6r3: { citation: ICH_E6_R3.citation, sectionVerification: ICH_E6_R3.sectionVerification, sectionStatus: E6_R3_SECTION_STATUS },
    systems,
    releaseConsistency: consistency,
    pendingValidatedChanges: PENDING_VALIDATED_CHANGES.map(change => pendingChange(change, id => repositories.get(id) ?? null, entries)),
    // Synthetic says synthetic in every artifact (D-22), the JSON included.
    ...(marking?.synthetic ? { synthetic: true as const, syntheticNotice: SYNTHETIC_NOTICE } : {}),
    ...(marking && !marking.retained ? { retention: DEVELOPMENT_RUN_NOTICE } : {}),
  };
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

const STATUS_TEXT: Record<SystemStatus, string> = { 'evidence-present-unapproved': 'Evidence present, unapproved', gap: 'Gap' };
const PROBE_TEXT: Record<ProbeStatus, string> = {
  open: 'open (probe matched)', 'probe-not-matched': 'probe not matched: re-verify, the gap may be closed', 'file-missing': 'probe file missing: inventory stale',
};
const code = (text: string) => `\`${text.replace(/`/g, '\'')}\``;
const short = (commit: string | null) => (commit ? commit.slice(0, 12) : 'not read');
const yesNo = (value: boolean | null) => (value === null ? 'not read' : value ? 'yes' : 'no');

/** A quoted line in a fence longer than any backtick run it holds, so the bytes show exactly. */
function fenced(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}\n`;
}

function statementCell(statement: StatementResult): string {
  if ('file' in statement) return `quoted: ${statement.file} line ${statement.line}`;
  return statement.status === 'not-stated' ? 'none stated' : statement.detail;
}

function evidenceCell(evidence: EvidenceRow[]): string {
  if (!evidence.length) return 'none cited';
  return PLATFORM_EVIDENCE_STATUSES.map(status => [status, evidence.filter(row => row.status === status).length] as const)
    .filter(([, count]) => count > 0).map(([status, count]) => `${count} ${status}`).join(', ');
}

function gapCell(gaps: GapRow[]): string {
  const probed = gaps.filter(gap => gap.probe).length;
  return `${gaps.length} (${probed} probed, ${gaps.length - probed} stated)`;
}

function systemDetail(system: SystemRow): string {
  let content = section(3, `${system.name} (${system.id})`);
  content += system.repo
    ? `- **Repository:** ${code(system.repo)} at HEAD ${system.head ?? 'not read (not its own git checkout)'}; tracked changes: ${yesNo(system.dirty)}\n`
    : '- **Repository:** not found under the platform root\n';
  content += `- **Status:** ${STATUS_TEXT[system.status]}\n`;
  content += `- **Evidence admitted:** ${system.evidenceAdmitted}\n\n`;
  content += '**TA3 uses:**\n\n';
  for (const use of system.ta3Uses) content += `- ${use}\n`;
  content += '\n';
  const statement = system.statement;
  if ('file' in statement) {
    content += `**Statement**, quoted from ${code(statement.file)} line ${statement.line} (file SHA-256 ${statement.fileSha256}):\n\n`;
    content += `${fenced(statement.text)}\n`;
  } else {
    content += `**Statement:** ${statement.status === 'not-stated' ? 'the repository states no qualification status (none in the inventory)' : statement.detail}\n\n`;
  }
  content += '**Evidence:**\n\n';
  content += system.evidence.length
    ? markdownTable(['Kind', 'Path', 'SHA-256', 'Synthetic', 'Status', 'Detail'], system.evidence.map(row => [
      row.kind, code(row.path), row.sha256, row.synthetic ? 'yes' : 'no', row.status, `${row.detail}${row.note ? ` (${row.note})` : ''}`,
    ])) + '\n'
    : 'No evidence is cited for this system.\n\n';
  content += '**Gaps:**\n\n';
  content += markdownTable(['Gap', 'Plan item', 'Probe', 'Text'], system.gaps.map(gap => [
    gap.id, gap.item,
    gap.probe ? `${gap.probe.rule} ${code(gap.probe.literal)} in ${code(gap.probe.file)}${gap.probe.line ? ` line ${gap.probe.line}` : ''}: ${PROBE_TEXT[gap.probe.status]}` : 'stated; re-verify at review',
    gap.text,
  ]));
  return `${content}\n`;
}

/** The document: the system table, each system, gaps by plan item, release consistency, the changes awaiting change
 * control and the ICH E6(R3) status. */
export function renderPlatformSummary(summary: PlatformValidationSummary): string {
  const date = summary.generatedAt.slice(0, 10);
  let content = documentHeader({
    title: 'Platform Validation Summary',
    documentId: `PVS-${date.slice(0, 4)}-001`,
    version: '1.0',
    date,
    system: `AccuraTrial platform: the ${summary.systems.length} systems of the platform inventory`,
    classification: 'Confidential, Regulatory',
  }) + '\n';

  content += section(2, 'Purpose');
  content += `This summary lists every computerised system a TA3 use relies on, with the evidence the platform evidence plan cites `
    + 'for it, each entry checked by hash, or its explicit gap with the plan item that closes it. It carries data, not verdicts: '
    + 'each statement is quoted from the repository\'s current bytes with the file\'s SHA-256 and line, a probe shows whether the code '
    + 'still shows its gap, and no system is reported qualified. Approval is a person\'s act recorded in the eTMF (TMF-FILING.md).\n\n';
  content += markdownTable(['Field', 'Value'], [
    ['Contract', `${summary.contract} (${PLATFORM_SUMMARY_FILE} beside this document)`],
    ['Generated at', summary.generatedAt],
    ['Inventory version', `${summary.inventoryVersion} (config/platform-inventory.ts)`],
    ['Platform root', code(summary.platformRoot)],
    ['Framework commit', `${summary.framework.commit ?? 'not read'} (tracked changes: ${yesNo(summary.framework.dirty)})`],
    ['Evidence plan', summary.evidencePlan
      ? `${code(summary.evidencePlan.path)}, SHA-256 ${summary.evidencePlan.sha256}, prepared by ${summary.evidencePlan.preparedBy}`
      : 'none: no evidence is cited, so every system shows its gap'],
  ]);
  content += '\n';
  content += hr();

  content += section(2, 'System Table');
  content += markdownTable(['System', 'Repository', 'HEAD', 'Tracked changes', 'Statement', 'Evidence', 'Gaps', 'Status'],
    summary.systems.map(system => [
      `${system.name} (${system.id})`, system.repo ?? 'not found', short(system.head), yesNo(system.dirty), statementCell(system.statement),
      evidenceCell(system.evidence), gapCell(system.gaps), STATUS_TEXT[system.status],
    ]));
  content += '\n';
  content += hr();

  content += section(2, 'Systems');
  for (const system of summary.systems) content += systemDetail(system);
  content += hr();

  content += section(2, 'Gaps by Plan Item');
  const items = [...new Set(summary.systems.flatMap(system => system.gaps.map(gap => gap.item)))].sort();
  for (const item of items) {
    content += section(3, item);
    for (const system of summary.systems) {
      for (const gap of system.gaps.filter(entry => entry.item === item)) {
        content += `- ${system.name} (${system.id}), ${gap.id}: ${gap.text}${gap.probe ? ` [${PROBE_TEXT[gap.probe.status]}]` : ' [stated]'}\n`;
      }
    }
    content += '\n';
  }
  content += hr();

  content += section(2, 'Release Consistency');
  const consistency = summary.releaseConsistency;
  content += `**Status: ${consistency.status}.** ${consistency.detail} The EDC API release of each cited OQ package is compared with the release `
    + `each cited O-7 import recorded in ${RELEASE_PQ_CASE}; ${RELEASE_PQ_CASE} itself is never rewritten.\n\n`;
  const sides = [...consistency.oq.map(side => ['OQ', side] as const), ...consistency.o7.map(side => ['O-7 import', side] as const)];
  if (sides.length) {
    content += markdownTable(['Side', 'Package', 'Manifest SHA-256', 'EDC API release', 'Detail'],
      sides.map(([label, side]) => [label, code(side.path), side.manifestSha256, apiText(side.api), side.detail]));
    content += '\n';
  }
  content += hr();

  content += section(2, 'Validated Changes Awaiting Change Control');
  for (const change of summary.pendingValidatedChanges) {
    content += section(3, `${change.id}: ${change.change}`);
    content += `**Status:** ${change.statusText}\n\n`;
    content += `**Production settings** (${change.system} ${code(change.flags[0]?.file ?? '')}${change.flags[0]?.fileSha256 ? `, SHA-256 ${change.flags[0].fileSha256}` : ', not read'}):\n\n`;
    content += markdownTable(['Setting', 'Line', 'Value as the EDC reads it'], change.flags.map(flag => [
      flag.flag, flag.line === null ? 'not set' : String(flag.line), flag.value === null ? 'not read' : String(flag.value),
    ]));
    content += '\n';
    content += `**OQ cases needed at the release to be deployed** (${change.oqCases.length}): ${change.oqCases.join(', ')}.\n\n`;
    content += change.oqEvidence.length
      ? markdownTable(['Cited OQ package', 'Manifest SHA-256', 'Synthetic', 'EDC API release', 'Passed', 'Not passed', 'Not recorded'],
        change.oqEvidence.map(row => [code(row.path), row.manifestSha256, row.synthetic ? 'yes' : 'no', row.api ?? 'not recorded',
          String(row.passed), String(row.notPassed), String(row.notRecorded)])) + '\n'
      : 'The evidence plan cites no verified OQ package.\n\n';
    const sop = change.category.sop;
    content += `**Change category:** ${change.category.name}. ${change.category.reason}.`;
    content += 'file' in sop
      ? ` Quoted from ${code(sop.file)} line ${sop.line} (file SHA-256 ${sop.fileSha256}):\n\n${fenced(sop.text)}\n`
      : ` The SOP row was not found (${sop.detail}).\n\n`;
  }
  content += hr();

  content += section(2, 'ICH E6(R3) References: Pending QA Verification');
  content += `Computerised system validation is cited as ${e6r3('validation')}. ${summary.e6r3.sectionStatus}: the section `
    + `numbers in config/regulatory-scope.ts are an analyst's reading of the ${ICH_E6_R3.step} text and stay pending QA verification `
    + `(sectionVerification ${summary.e6r3.sectionVerification}).\n\n`;
  content += hr();

  content += approvalBlock(['Validation Lead', 'Quality Assurance Lead', 'System Owner']);
  content += '\n---\n*End of Document*\n';
  return content;
}

/** Document 22 and its JSON. Generator-specific options come from generate.ts only. */
export function generate(outputDir: string, workspaceRoot: string, options: PlatformSummaryOptions = {}): void {
  const summary = buildPlatformSummary(workspaceRoot, options);
  fs.writeFileSync(path.join(outputDir, PLATFORM_SUMMARY_FILE), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, PLATFORM_SUMMARY_DOCUMENT), renderPlatformSummary(summary));
}
