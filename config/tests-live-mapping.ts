export interface TestLiveMapping {
  scriptPath: string;
  description: string;
  testCaseIds: string[];
  domain: string;
}

export const TESTS_LIVE_MAPPINGS: TestLiveMapping[] = [
  // ─── Setup scripts (00–09) ────────────────────────────────────────────────

  {
    scriptPath: 'scripts/setup/00a-cleanup-previous-runs.ts',
    description: 'Cleanup previous test runs (FK-safe cascade delete)',
    testCaseIds: ['PQ-001'],
    domain: 'test-infrastructure',
  },
  {
    scriptPath: 'scripts/setup/00-register-organization.ts',
    description: 'Organization registration and admin user creation',
    testCaseIds: ['OQ-002', 'OQ-001'],
    domain: 'authentication',
  },
  {
    scriptPath: 'scripts/setup/01-create-members.ts',
    description: 'User creation with coordinator and monitor roles',
    testCaseIds: ['OQ-011', 'OQ-012', 'OQ-022'],
    domain: 'access-control',
  },
  {
    scriptPath: 'scripts/setup/02-login-admin.ts',
    description: 'JWT authentication and token validation',
    testCaseIds: ['OQ-001', 'OQ-003', 'OQ-005'],
    domain: 'authentication',
  },
  {
    scriptPath: 'scripts/setup/03-create-base-ecrfs.ts',
    description: 'eCRF template creation with branching, validation, and workflow fields',
    testCaseIds: ['PQ-007', 'OQ-043', 'PQ-011'],
    domain: 'forms',
  },
  {
    scriptPath: 'scripts/setup/04-fork-ecrfs-validation.ts',
    description: 'Validation eCRF state aliasing for downstream scripts',
    testCaseIds: ['OQ-043'],
    domain: 'forms',
  },
  {
    scriptPath: 'scripts/setup/05-fork-ecrfs-workflow.ts',
    description: 'Workflow eCRF state aliasing for downstream scripts',
    testCaseIds: ['PQ-008'],
    domain: 'workflows',
  },
  {
    scriptPath: 'scripts/setup/06-create-study.ts',
    description: 'Study creation with sites, visits, and eCRF assignments',
    testCaseIds: ['PQ-001', 'PQ-002', 'PQ-003', 'PQ-006'],
    domain: 'study-management',
  },
  {
    scriptPath: 'scripts/setup/07-create-validation-rules.ts',
    description: 'Validation rule creation (range, required, regex, consistency, value_match)',
    testCaseIds: ['OQ-043', 'OQ-044', 'PQ-008', 'PQ-011'],
    domain: 'validation',
  },
  {
    scriptPath: 'scripts/setup/08-setup-workflows.ts',
    description: 'Workflow config: SDV, e-signature, DDE, query routing',
    testCaseIds: ['PQ-008', 'PQ-013', 'PQ-015'],
    domain: 'workflows',
  },
  {
    scriptPath: 'scripts/setup/09-create-patient.ts',
    description: 'Patient enrollment across multiple sites with visit scheduling',
    testCaseIds: ['PQ-004', 'PQ-005', 'PQ-006'],
    domain: 'subjects',
  },

  // ─── Testing scripts (10–35) ──────────────────────────────────────────────

  {
    scriptPath: 'scripts/testing/10-fill-forms-and-test.ts',
    description: 'Form data entry with validation triggers and workflow checks',
    testCaseIds: ['PQ-007', 'OQ-043', 'OQ-044', 'OQ-049'],
    domain: 'data-entry',
  },
  {
    scriptPath: 'scripts/testing/11-branching-ecrf-test.ts',
    description: 'Branching eCRF skip logic and conditional field display',
    testCaseIds: ['PQ-011', 'OQ-043', 'PQ-007'],
    domain: 'forms',
  },
  {
    scriptPath: 'scripts/testing/11a-branching-forms-crud-test.ts',
    description: 'Embedded/linked form CRUD lifecycle with formLinks',
    testCaseIds: ['PQ-011', 'PQ-007'],
    domain: 'forms',
  },
  {
    scriptPath: 'scripts/testing/11b-skip-logic-roundtrip-test.ts',
    description: 'Skip logic data save/retrieve round-trip verification',
    testCaseIds: ['PQ-011', 'PQ-007', 'OQ-049'],
    domain: 'forms',
  },
  {
    scriptPath: 'scripts/testing/11c-branching-edge-cases-test.ts',
    description: 'Branching edge cases: first-option trigger, multi-formLink, hiddenFields',
    testCaseIds: ['PQ-011', 'OQ-043'],
    domain: 'forms',
  },
  {
    scriptPath: 'scripts/testing/11d-embedded-forms-deep-test.ts',
    description: 'Deep embedded forms: parent→child→grandchild with validation',
    testCaseIds: ['PQ-011', 'PQ-007', 'OQ-043'],
    domain: 'forms',
  },
  {
    scriptPath: 'scripts/testing/12-patient-visits-forms.ts',
    description: 'Patient visit lifecycle and form snapshot architecture',
    testCaseIds: ['PQ-006', 'PQ-007', 'OQ-049'],
    domain: 'visits',
  },
  {
    scriptPath: 'scripts/testing/12-diagnose-warning-queries.ts',
    description: 'Soft validation warning → auto query generation',
    testCaseIds: ['OQ-043', 'OQ-050', 'PQ-009'],
    domain: 'validation',
  },
  {
    scriptPath: 'scripts/testing/13-query-response-workflow.ts',
    description: 'Full query lifecycle: create, respond, accept, reject, reopen, reassign, bulk close',
    testCaseIds: ['OQ-050', 'PQ-009', 'OQ-023', 'OQ-029'],
    domain: 'queries',
  },
  {
    scriptPath: 'scripts/testing/14-task-system-verification.ts',
    description: 'Task generation, routing by role, completion, and dismissal',
    testCaseIds: ['PQ-008', 'OQ-011', 'OQ-013', 'OQ-014'],
    domain: 'workflows',
  },
  {
    scriptPath: 'scripts/testing/15-form-completion-signing.ts',
    description: 'Form completion status and e-signature with password re-authentication',
    testCaseIds: ['OQ-033', 'OQ-034', 'OQ-035', 'OQ-036', 'OQ-037', 'OQ-039', 'PQ-015'],
    domain: 'e-signatures',
  },
  {
    scriptPath: 'scripts/testing/16-data-locking-process.ts',
    description: 'Data lock lifecycle: freeze, lock, unlock at form/event/subject level',
    testCaseIds: ['OQ-051', 'OQ-052', 'OQ-053', 'OQ-054', 'OQ-055', 'PQ-017', 'PQ-018', 'PQ-019'],
    domain: 'data-locks',
  },
  {
    scriptPath: 'scripts/testing/17-date-validation-verification.ts',
    description: 'Date handling: round-trip, validation rules, audit timestamps, overdue detection',
    testCaseIds: ['OQ-026', 'OQ-043', 'OQ-044', 'PQ-007'],
    domain: 'validation',
  },
  {
    scriptPath: 'scripts/testing/18-unscheduled-visits-test.ts',
    description: 'Unscheduled visit creation without wiping existing visits/data',
    testCaseIds: ['PQ-006', 'PQ-007', 'OQ-049'],
    domain: 'visits',
  },
  {
    scriptPath: 'scripts/testing/19-form-save-isolation-test.ts',
    description: 'Form save isolation: no cross-visit or cross-patient data leakage',
    testCaseIds: ['PQ-007', 'OQ-049', 'PQ-006'],
    domain: 'data-entry',
  },
  {
    scriptPath: 'scripts/testing/20-full-trial-ui-test.ts',
    description: 'Full clinical trial lifecycle UI test (Playwright browser)',
    testCaseIds: ['PQ-001', 'PQ-004', 'PQ-007', 'PQ-009', 'PQ-015', 'PQ-017'],
    domain: 'ui-integration',
  },
  {
    scriptPath: 'scripts/testing/21-comprehensive-crud-test.ts',
    description: 'Comprehensive CRUD for studies, eCRFs, patients, visits, queries, validation, locks',
    testCaseIds: ['PQ-001', 'PQ-004', 'PQ-007', 'PQ-009', 'PQ-015', 'PQ-017', 'OQ-023', 'OQ-033', 'OQ-043', 'OQ-050', 'OQ-051'],
    domain: 'regression',
  },
  {
    scriptPath: 'scripts/testing/22-new-features-test.ts',
    description: 'Analytics dashboard APIs and required field toggle validation',
    testCaseIds: ['OQ-043', 'OQ-044', 'PQ-007'],
    domain: 'analytics',
  },
  {
    scriptPath: 'scripts/testing/23-bugfix-verification-test.ts',
    description: 'Regression: SOAP dedup, dropdown save, user isolation, visit snapshots',
    testCaseIds: ['OQ-049', 'PQ-005', 'PQ-006', 'PQ-007'],
    domain: 'regression',
  },
  {
    scriptPath: 'scripts/testing/24-detailed-fix-verification.ts',
    description: 'Detailed fix verification: dedup, select round-trip, cross-org isolation, auto-repair',
    testCaseIds: ['OQ-049', 'PQ-005', 'PQ-006', 'PQ-007'],
    domain: 'regression',
  },
  {
    scriptPath: 'scripts/testing/25-table-crud-verification.ts',
    description: 'Table/question_table/criteria_list CRUD via JSONB save/reload cycle',
    testCaseIds: ['PQ-007', 'OQ-049'],
    domain: 'data-entry',
  },
  {
    scriptPath: 'scripts/testing/26-comprehensive-table-file-image-test.ts',
    description: 'Table complex cell types, file upload CRUD, image field CRUD',
    testCaseIds: ['PQ-007', 'OQ-049', 'OQ-045'],
    domain: 'data-entry',
  },
  {
    scriptPath: 'scripts/testing/27-run-all.ts',
    description: 'Runner for 27a–27d detailed CRUD sub-tests',
    testCaseIds: ['PQ-007', 'OQ-049'],
    domain: 'data-entry',
  },
  {
    scriptPath: 'scripts/testing/27a-table-crud-detailed.ts',
    description: 'Detailed table field CRUD with add/update/delete row operations',
    testCaseIds: ['PQ-007', 'OQ-049'],
    domain: 'data-entry',
  },
  {
    scriptPath: 'scripts/testing/27b-question-table-crud.ts',
    description: 'Question table field CRUD with structured row/column values',
    testCaseIds: ['PQ-007', 'OQ-049'],
    domain: 'data-entry',
  },
  {
    scriptPath: 'scripts/testing/27c-file-upload-crud.ts',
    description: 'File and image upload lifecycle: upload, retrieve, download, delete',
    testCaseIds: ['OQ-045', 'PQ-007'],
    domain: 'data-entry',
  },
  {
    scriptPath: 'scripts/testing/27d-form-save-load.ts',
    description: 'Form data save and reload integrity across all field types',
    testCaseIds: ['PQ-007', 'OQ-049'],
    domain: 'data-entry',
  },
  {
    scriptPath: 'scripts/testing/29-question-table-full-crud.ts',
    description: 'Full question table and data table CRUD on production',
    testCaseIds: ['PQ-007', 'OQ-049'],
    domain: 'data-entry',
  },
  {
    scriptPath: 'scripts/testing/31-bugfix-verification-tests.ts',
    description: 'Bug fix verification: subject CRUD, validate-field, file CORS, visit scheduling',
    testCaseIds: ['PQ-004', 'PQ-006', 'PQ-007', 'OQ-043'],
    domain: 'regression',
  },
  {
    scriptPath: 'scripts/testing/32-full-production-verification.ts',
    description: 'Full production verification for 17 tracked bug fixes',
    testCaseIds: ['PQ-004', 'PQ-006', 'PQ-007', 'OQ-043', 'OQ-049'],
    domain: 'regression',
  },
  {
    scriptPath: 'scripts/testing/33-recent-changes-verification.ts',
    description: 'Recent changes: query mapper, site_name, form folders, consent gate, CORS',
    testCaseIds: ['OQ-050', 'PQ-009', 'PQ-007'],
    domain: 'regression',
  },
  {
    scriptPath: 'scripts/testing/34-comprehensive-ui-feature-test.ts',
    description: 'UI feature test: patient detail, visits, form folders, eConsent (Playwright)',
    testCaseIds: ['PQ-001', 'PQ-004', 'PQ-006', 'PQ-007'],
    domain: 'ui-integration',
  },
  {
    scriptPath: 'scripts/testing/35-smoke-test.ts',
    description: 'Production smoke test: login and dashboard verification (Playwright)',
    testCaseIds: ['IQ-002', 'IQ-003', 'OQ-001'],
    domain: 'smoke',
  },

  // ─── Standalone testing scripts ───────────────────────────────────────────

  {
    scriptPath: 'scripts/test-part11-signatures.ts',
    description: 'Part 11 e-signature integration: password-only, dual-credential, and no-password patterns',
    testCaseIds: ['OQ-033', 'OQ-034', 'OQ-035', 'OQ-036', 'OQ-037', 'OQ-042'],
    domain: 'e-signatures',
  },
  {
    scriptPath: 'scripts/test-deletions.ts',
    description: 'Deletion and archive tests for all entity types with e-signature enforcement',
    testCaseIds: ['OQ-020', 'OQ-018', 'OQ-042'],
    domain: 'access-control',
  },
  {
    scriptPath: 'scripts/test-full-workflows.ts',
    description: 'Comprehensive Part 11 + workflow integration: study/form/visit/patient/query/lock/sign',
    testCaseIds: ['PQ-001', 'PQ-004', 'PQ-007', 'PQ-009', 'PQ-015', 'PQ-017', 'OQ-033', 'OQ-050', 'OQ-051'],
    domain: 'workflows',
  },
  {
    scriptPath: 'scripts/test-pending-correction-workflow.ts',
    description: 'Query pending correction approval: store, accept/apply, reject/discard with e-signatures',
    testCaseIds: ['OQ-050', 'PQ-009', 'PQ-010', 'OQ-029', 'OQ-042'],
    domain: 'queries',
  },

  // ─── 31-series: Query on complex field types ──────────────────────────────

  {
    scriptPath: 'scripts/31a-query-create-on-fields.ts',
    description: 'Create queries on table, dropdown, number, and text field types',
    testCaseIds: ['OQ-050', 'PQ-009'],
    domain: 'queries',
  },
  {
    scriptPath: 'scripts/31b-query-resolve-data-correction.ts',
    description: 'Resolve queries with data corrections (item_data + JSONB sync + audit)',
    testCaseIds: ['OQ-050', 'PQ-009', 'PQ-010', 'OQ-024', 'OQ-029'],
    domain: 'queries',
  },
  {
    scriptPath: 'scripts/31c-hard-soft-query-enforcement.ts',
    description: 'Hard edit blocks save (no query) vs soft edit allows save (creates query)',
    testCaseIds: ['OQ-043', 'OQ-044', 'OQ-050', 'PQ-009'],
    domain: 'validation',
  },
  {
    scriptPath: 'scripts/31d-query-complex-fields.ts',
    description: 'Query resolution on complex in-table structures (select/combobox/checkbox/radio)',
    testCaseIds: ['OQ-050', 'PQ-009', 'PQ-010'],
    domain: 'queries',
  },
  {
    scriptPath: 'scripts/31e-ui-query-test.ts',
    description: 'UI query creation and resolution on complex fields (Playwright)',
    testCaseIds: ['OQ-050', 'PQ-009'],
    domain: 'ui-integration',
  },
  {
    scriptPath: 'scripts/31f-table-dropdown-combobox-query-verify.ts',
    description: 'Deep verification: table dropdown/combobox query resolution persists and reloads',
    testCaseIds: ['OQ-050', 'PQ-009', 'PQ-010', 'OQ-049'],
    domain: 'queries',
  },
  {
    scriptPath: 'scripts/31g-question-table-complex-query-verify.ts',
    description: 'Deep verification: question table select/combobox/radio query resolution',
    testCaseIds: ['OQ-050', 'PQ-009', 'PQ-010'],
    domain: 'queries',
  },
  {
    scriptPath: 'scripts/31h-hard-stop-table-complex.ts',
    description: 'Hard stop enforcement inside table cells: dropdown, combobox, number columns',
    testCaseIds: ['OQ-043', 'OQ-044', 'OQ-050'],
    domain: 'validation',
  },
  {
    scriptPath: 'scripts/31i-multi-row-multi-col-table-query-roundtrip.ts',
    description: 'Multi-row multi-column table query correction round-trips without clobbering',
    testCaseIds: ['OQ-050', 'PQ-009', 'PQ-010', 'OQ-049'],
    domain: 'queries',
  },
  {
    scriptPath: 'scripts/31j-edge-cases-boundary-rejected-resolutions.ts',
    description: 'Edge cases: empty table, boundary values, rejected resolutions, special characters',
    testCaseIds: ['OQ-050', 'PQ-009', 'PQ-010', 'OQ-043'],
    domain: 'queries',
  },
  {
    scriptPath: 'scripts/31k-query-field-linkage-roundtrip.ts',
    description: 'Query-to-field linkage: dn_item_data_map column_name, multi-query per field, counts',
    testCaseIds: ['OQ-050', 'PQ-009'],
    domain: 'queries',
  },

  // ─── Utility/runner scripts ───────────────────────────────────────────────

  {
    scriptPath: 'scripts/setup/setup-account.ts',
    description: 'Full setup pipeline runner (00a through 21)',
    testCaseIds: ['PQ-001', 'PQ-002', 'PQ-004', 'PQ-007'],
    domain: 'test-infrastructure',
  },
  {
    scriptPath: 'scripts/setup/setup-full-test.ts',
    description: 'Enhanced full setup with all regions: forms, study, patients, queries',
    testCaseIds: ['PQ-001', 'PQ-002', 'PQ-004', 'PQ-007', 'PQ-009'],
    domain: 'test-infrastructure',
  },
  {
    scriptPath: 'scripts/setup/query-test-setup.ts',
    description: 'Query test data setup: complex eCRFs with table/select/combobox fields',
    testCaseIds: ['PQ-007', 'OQ-050'],
    domain: 'test-infrastructure',
  },
  {
    scriptPath: 'scripts/31-run-all.ts',
    description: 'Runner for 31a–31k query test suite',
    testCaseIds: ['OQ-050', 'PQ-009', 'PQ-010'],
    domain: 'test-infrastructure',
  },
  {
    scriptPath: 'scripts/testing/run-all.ts',
    description: 'Sequential E2E test suite runner for all testing scripts',
    testCaseIds: ['PQ-001', 'PQ-004', 'PQ-007', 'PQ-009', 'PQ-015', 'PQ-017'],
    domain: 'test-infrastructure',
  },
  {
    scriptPath: 'scripts/testing/verify-fixes.ts',
    description: 'Targeted fix verification: form dedup and patient visit copying',
    testCaseIds: ['PQ-006', 'PQ-007', 'OQ-049'],
    domain: 'regression',
  },
  {
    scriptPath: 'scripts/testing/test-visit-copy.ts',
    description: 'Visit and eCRF copy-to-patient pipeline with data isolation',
    testCaseIds: ['PQ-006', 'PQ-007', 'OQ-049'],
    domain: 'data-entry',
  },
  {
    scriptPath: 'scripts/testing/ui-test.ts',
    description: 'Comprehensive UI navigation, validation, branching, and save isolation test',
    testCaseIds: ['PQ-001', 'PQ-007', 'PQ-011', 'OQ-043'],
    domain: 'ui-integration',
  },
];

export function getScriptsByDomain(domain: string): TestLiveMapping[] {
  return TESTS_LIVE_MAPPINGS.filter((m) => m.domain === domain);
}

export function getScriptsForTestCase(testCaseId: string): TestLiveMapping[] {
  return TESTS_LIVE_MAPPINGS.filter((m) => m.testCaseIds.includes(testCaseId));
}

export function getAllDomains(): string[] {
  return [...new Set(TESTS_LIVE_MAPPINGS.map((m) => m.domain))];
}

export function getAllMappedTestCaseIds(): string[] {
  const ids = new Set<string>();
  for (const m of TESTS_LIVE_MAPPINGS) {
    for (const id of m.testCaseIds) {
      ids.add(id);
    }
  }
  return [...ids].sort();
}
