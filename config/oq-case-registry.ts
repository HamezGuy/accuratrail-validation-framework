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
];

export const OQ_LAST_CASE = OQ_SUITES[OQ_SUITES.length - 1].last;

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
