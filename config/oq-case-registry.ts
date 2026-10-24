/**
 * The one list of OQ case IDs. The OQ runner records a result (executed, or
 * "did not execute") for exactly these IDs, and the OQ protocol document lists
 * exactly these IDs, so the pre-approved protocol and the executed evidence
 * cannot drift apart. Suites follow the runner's own suite boundaries.
 */
export interface OqSuite {
  suite: number;
  title: string;
  first: number;
  last: number;
  /** What the suite verifies; per-case descriptions, acceptance criteria and
   * regulatory references are recorded by the runner in each evidence record. */
  scope: string;
  regulatoryFocus: string;
}

export const OQ_SUITES: readonly OqSuite[] = [
  { suite: 1, title: 'Authentication Tests', first: 1, last: 10, scope: 'Login, session, password policy and lockout', regulatoryFocus: '§11.10(d), §11.300' },
  { suite: 2, title: 'Access Control Tests', first: 11, last: 22, scope: 'Role-based permissions, positive and negative', regulatoryFocus: '§11.10(d), §11.10(g)' },
  { suite: 3, title: 'Audit Trail Tests', first: 23, last: 32, scope: 'Create, update and delete auditing, immutability, export', regulatoryFocus: '§11.10(e)' },
  { suite: 4, title: 'E-Signature Tests', first: 33, last: 42, scope: 'Re-authentication, manifestation, linkage, non-repudiation', regulatoryFocus: '§11.50, §11.70, §11.200' },
  { suite: 5, title: 'Data Operations Tests', first: 43, last: 50, scope: 'eCRF data entry, validation rules, exports, query workflow', regulatoryFocus: '§11.10(a), §11.10(b)' },
  { suite: 6, title: 'Data Lock Tests', first: 51, last: 55, scope: 'Freeze and lock enforcement, unlock workflow', regulatoryFocus: '§11.10(a), §11.10(e)' },
  { suite: 7, title: 'Part 11 Compliance Controls Tests', first: 56, last: 75, scope: 'Password expiry and history, session revocation, independent sessions, audit write failure, PHI redaction, lockout alerts', regulatoryFocus: '§11.10, §11.300' },
  { suite: 8, title: 'Comprehensive Authentication Tests', first: 76, last: 95, scope: 'Owned disposable accounts: password policy, lockout, concurrent sessions, token handling', regulatoryFocus: '§11.10(d), §11.300' },
  { suite: 9, title: 'Comprehensive RBAC Tests', first: 96, last: 120, scope: 'Role matrix over study, form, subject, query and audit endpoints; unauthenticated refusal of protected endpoints', regulatoryFocus: '§11.10(d), §11.10(g)' },
  { suite: 10, title: 'Comprehensive Audit Trail Tests', first: 121, last: 145, scope: 'Audit record fields, filtering, export and refusal of audit mutation', regulatoryFocus: '§11.10(e), §11.10(c)' },
  { suite: 11, title: 'Data Operations Deep Tests', first: 146, last: 170, scope: 'Subjects, events, forms, queries, pagination, malformed identifiers and dashboards', regulatoryFocus: '§11.10(a), §11.10(h)' },
  { suite: 12, title: 'Security and Input Validation Tests', first: 171, last: 205, scope: 'Input validation, injection and header probes, native downloads (PDF, CSV, ODM), batch SDV, failed signature attempts', regulatoryFocus: '§11.10(a), §11.10(c), §11.10(h)' },
  // The TA3 suites (TA3 plan VAL-1, spec P20 3.4), appended without renumbering. They run against the
  // designated armed study a ta3-oq-plan/1 names; their cases are detailed in config/ta3-oq-cases.ts.
  { suite: 13, title: 'Deviation Detection on Save and in the Sweep', first: 206, last: 214, scope: 'Engine armed at the target, save-time detection and its negative control, unevaluated subjects, sweep detection of an absence rule, no duplicate deviation, append-only receipts, correction history, the follow-up task through domain events', regulatoryFocus: '§11.10(a), §11.10(e)' },
  { suite: 14, title: 'Protocol Version Applicability', first: 215, last: 218, scope: 'Restricted recording, stated dates, the governing version by planned visit date, unresolved applicability stated explicitly', regulatoryFocus: '§11.10(a), §11.10(g)' },
  { suite: 15, title: 'Deviation Assessment and Reviewer Independence', first: 219, last: 226, scope: 'Platform list with site deviations, occurrence date and basis, signed assessment by another person, importance rules, second-person not-a-deviation closure, corrective-action review independence, stale decisions refused', regulatoryFocus: '§11.10(d), §11.10(g), §11.50, §11.70, §11.200' },
  { suite: 16, title: 'Deviation Escalation Timing', first: 227, last: 231, scope: 'Signed, independently reviewed escalation policy; one escalation per level for unassessed deviations and overdue corrective actions; codes only, no arm', regulatoryFocus: '§11.10(a), §11.10(e)' },
  { suite: 17, title: 'TA3 Metrics Ledger Records', first: 232, last: 238, scope: 'Signed milestones in force only after independent review; milestone, effort and latency documents as exact bytes; blinded readers; the one-snapshot TA3 ledger; no rewrite under a request key', regulatoryFocus: '§11.10(a), §11.10(b), §11.10(c), §11.10(e), §11.50' },
  { suite: 18, title: 'Inspection Copy Completeness', first: 239, last: 244, scope: 'Flat copy byte for byte, deviation records, the TA3 inventory and its flag, segmented-only receipts, segmented content, role restriction', regulatoryFocus: '§11.10(b), §11.10(c), §11.10(e)' },
];

export const OQ_LAST_CASE = OQ_SUITES[OQ_SUITES.length - 1].last;

/** Suites 1 to 12 share one operator session and one owned synthetic fixture, so they run together. */
export const BASE_OQ_SUITES: readonly number[] = OQ_SUITES.filter(suite => suite.suite <= 12).map(suite => suite.suite);
/** The TA3 suites; each opens its own sessions for the accounts a ta3-oq-plan/1 names. */
export const TA3_OQ_SUITES: readonly number[] = OQ_SUITES.filter(suite => suite.suite >= 13).map(suite => suite.suite);

/** What `--oq-suites` selected: whether the base suites run, and which TA3 suites. */
export interface OqSuiteSelection {
  base: boolean;
  ta3: readonly number[];
}

export const ALL_OQ_SUITES: OqSuiteSelection = { base: true, ta3: TA3_OQ_SUITES };

/** Reads `--oq-suites`, a comma-separated list of suite numbers and ranges such as
 * `13-18` or `1-12,15`. The base suites 1 to 12 are selected together or not at
 * all, because they share one session and one owned fixture; an unknown suite, an
 * empty list or a reversed range is refused. */
export function parseOqSuiteSelection(text: string): OqSuiteSelection {
  const known = new Set(OQ_SUITES.map(suite => suite.suite));
  const chosen = new Set<number>();
  for (const part of text.split(',')) {
    const match = /^\s*(\d{1,2})\s*(?:-\s*(\d{1,2})\s*)?$/.exec(part);
    if (!match) throw new Error(`--oq-suites takes suite numbers and ranges such as 13-18; ${JSON.stringify(part.trim())} is neither.`);
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (last < first) throw new Error(`--oq-suites range ${first}-${last} is reversed.`);
    for (let suite = first; suite <= last; suite++) {
      if (!known.has(suite)) throw new Error(`--oq-suites names suite ${suite}; the registry has suites 1 to ${OQ_SUITES.length}.`);
      chosen.add(suite);
    }
  }
  const base = BASE_OQ_SUITES.filter(suite => chosen.has(suite));
  if (base.length && base.length !== BASE_OQ_SUITES.length) {
    throw new Error('--oq-suites selects suites 1 to 12 together or not at all: they share one operator session and one owned fixture.');
  }
  return { base: base.length > 0, ta3: TA3_OQ_SUITES.filter(suite => chosen.has(suite)) };
}

/** The suite a case belongs to. */
export function oqSuiteOf(testCaseId: string): OqSuite | undefined {
  const match = /^OQ-(\d{3})$/.exec(testCaseId);
  const number = match ? Number(match[1]) : NaN;
  return OQ_SUITES.find(suite => number >= suite.first && number <= suite.last);
}

/** Defined in the protocol but not executed by the automated runner; the runner
 * records each as not executed, so it needs separate execution evidence. */
export const OQ_NOT_AUTOMATED: ReadonlySet<string> = new Set(['OQ-073', 'OQ-074', 'OQ-075']);

export function oqCaseId(number: number): string {
  return `OQ-${String(number).padStart(3, '0')}`;
}

export const OQ_CASE_IDS: readonly string[] = Array.from({ length: OQ_LAST_CASE }, (_, index) => oqCaseId(index + 1));

export function oqSuiteCaseIds(suite: OqSuite): string[] {
  return Array.from({ length: suite.last - suite.first + 1 }, (_, index) => oqCaseId(suite.first + index));
}

/** Contiguous, non-overlapping suites from OQ-001; checked when the protocol is generated. */
export function assertOqRegistryContiguous(): void {
  let expected = 1;
  for (const suite of OQ_SUITES) {
    if (suite.first !== expected || suite.last < suite.first) {
      throw new Error(`OQ suite ${suite.suite} must start at ${oqCaseId(expected)}.`);
    }
    expected = suite.last + 1;
  }
}
