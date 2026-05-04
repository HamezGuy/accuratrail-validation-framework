import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_INFO } from '../config/system-info';
import { REGULATORY_SCOPE } from '../config/regulatory-scope';
import {
  documentHeader,
  section,
  approvalBlock,
  tableOfContents,
  hr,
  markdownTable,
  riskBadge,
  type SectionEntry,
} from './helpers/markdown-writer';
import { getDocumentMeta, stampDocument } from './helpers/version-stamper';

interface PqTestCase {
  id: string;
  title: string;
  requirement: string;
  cfr: string;
  riskLevel: 'Critical' | 'High' | 'Medium' | 'Low';
  preconditions: string;
  steps: string[];
  expectedResult: string;
  evidence: string;
}

const YEAR = new Date().getFullYear();
const DOC_ID = `PQ-${YEAR}-001`;

function pqTestCaseBlock(tc: PqTestCase): string {
  const lines: string[] = [
    `### ${tc.id}: ${tc.title}`,
    '',
    `- **Requirement:** ${tc.requirement}`,
    `- **CFR Reference:** ${tc.cfr}`,
    `- **Risk Level:** ${riskBadge(tc.riskLevel)}`,
    `- **Preconditions:** ${tc.preconditions}`,
    '- **Steps:**',
  ];

  tc.steps.forEach((step, i) => {
    lines.push(`  ${i + 1}. ${step}`);
  });

  lines.push(
    `- **Expected Result:** ${tc.expectedResult}`,
    '- **Actual Result:** _[To be completed]_',
    '- **Pass/Fail:** _[Pending]_',
    `- **Evidence:** _[See evidence/pq/]_`,
    '',
  );

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Section 4 — Study Setup (PQ-001 to PQ-003)                       */
/* ------------------------------------------------------------------ */

function studySetupCases(): PqTestCase[] {
  return [
    {
      id: 'PQ-001',
      title: 'Complete Study Creation',
      requirement: 'FRS-STUDY-001',
      cfr: '§11.10(a) — Validation',
      riskLevel: 'Critical',
      preconditions: 'Admin or study_admin user logged in',
      steps: [
        'Navigate to study creation.',
        'Fill basic info tab (title, protocol number, phase, therapeutic area).',
        'Fill facilities tab (add sites).',
        'Fill protocol tab (objectives, endpoints).',
        'Fill eligibility tab (inclusion/exclusion criteria).',
        'Fill design tab (randomization, blinding).',
        'Fill visits tab (visit schedule).',
        'Fill groups tab (treatment arms).',
        'Fill settings tab (features, locks).',
        'Submit study creation.',
        'Verify study appears in study list with all configuration.',
      ],
      expectedResult:
        'Study created with complete multi-tab configuration, all settings persisted and retrievable.',
      evidence: 'See evidence/pq/PQ-001.json',
    },
    {
      id: 'PQ-002',
      title: 'Site and User Setup',
      requirement: 'FRS-STUDY-002 / URS-RBAC-001',
      cfr: '§11.10(d) — Authority checks',
      riskLevel: 'High',
      preconditions: 'Study created (PQ-001 complete)',
      steps: [
        'Add site(s) to the study.',
        'Create or assign users with specific roles (investigator, coordinator, monitor, data_manager).',
        'Verify each user can log in and access the study.',
        'Verify role-appropriate menus/features visible.',
      ],
      expectedResult:
        'Sites added, users assigned with roles, each user accesses study with correct permissions.',
      evidence: 'See evidence/pq/PQ-002.json',
    },
    {
      id: 'PQ-003',
      title: 'CRF Assignment to Study',
      requirement: 'FRS-FORM-001',
      cfr: '§11.10(a) — Validation',
      riskLevel: 'High',
      preconditions: 'Study with visits defined (PQ-001), eCRF templates exist',
      steps: [
        'Assign eCRF templates to specific study visits.',
        'Verify each visit shows assigned forms.',
        'Verify form structure (fields, validations) is correct for each assigned form.',
      ],
      expectedResult:
        'eCRF templates assigned to visits, forms available at each visit with correct structure.',
      evidence: 'See evidence/pq/PQ-003.json',
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Section 5 — Subject Enrollment (PQ-004 to PQ-006)                 */
/* ------------------------------------------------------------------ */

function subjectEnrollmentCases(): PqTestCase[] {
  return [
    {
      id: 'PQ-004',
      title: 'Subject Enrollment Workflow',
      requirement: 'FRS-SUBJ-001',
      cfr: '§11.10(a) / §11.10(e) — Validation / Audit trails',
      riskLevel: 'Critical',
      preconditions:
        'Organization registered, study created with visits and forms, coordinator logged in',
      steps: [
        'Register organization if not done (POST /api/organizations).',
        'Create study with full config.',
        'Navigate to subject enrollment.',
        'Complete 3-step enrollment wizard (demographics, eligibility verification, consent).',
        'Verify subject ID assigned (auto-generated or manual).',
        'Verify visit schedule generated with all planned visits.',
        'Verify audit trail for enrollment.',
      ],
      expectedResult:
        'Subject enrolled, unique ID assigned, complete visit schedule auto-generated, enrollment audited.',
      evidence: 'See evidence/pq/PQ-004.json',
    },
    {
      id: 'PQ-005',
      title: 'Duplicate Subject Prevention',
      requirement: 'FRS-SUBJ-002',
      cfr: '§11.10(a) — Validation',
      riskLevel: 'High',
      preconditions: 'Subject already enrolled with known ID',
      steps: [
        'Attempt to enroll another subject with the same subject ID.',
        'Verify system rejects with appropriate error (409/400).',
        'Verify original subject unaffected.',
      ],
      expectedResult:
        'System rejects duplicate subject ID, returns clear error message.',
      evidence: 'See evidence/pq/PQ-005.json',
    },
    {
      id: 'PQ-006',
      title: 'Visit Schedule Auto-Generation',
      requirement: 'FRS-VISIT-001',
      cfr: '§11.10(a) — Validation',
      riskLevel: 'High',
      preconditions: 'Subject enrolled (PQ-004)',
      steps: [
        "GET subject's visit schedule.",
        'Verify all planned visits present.',
        'Verify each visit has correct assigned forms.',
        'Verify visit windows/dates if applicable.',
      ],
      expectedResult:
        'All scheduled visits appear with correct forms assigned per study design.',
      evidence: 'See evidence/pq/PQ-006.json',
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Section 6 — Data Entry and Queries (PQ-007 to PQ-012)             */
/* ------------------------------------------------------------------ */

function dataEntryQueryCases(): PqTestCase[] {
  return [
    {
      id: 'PQ-007',
      title: 'Complete eCRF Entry',
      requirement: 'FRS-DATA-002 / URS-AUDIT-002',
      cfr: '§11.10(a) / §11.10(e) — Validation / Audit trails',
      riskLevel: 'Critical',
      preconditions: 'Subject enrolled with visit schedule, coordinator logged in',
      steps: [
        'Navigate to subject, select a visit, open assigned form.',
        'Enter all field values (text, numeric, date, dropdown).',
        'Save form.',
        'Verify save confirmation.',
        'GET /api/audit to verify data entry audit trail.',
      ],
      expectedResult:
        'All form fields saved, data retrievable, audit trail records creation with user identity and timestamp.',
      evidence: 'See evidence/pq/PQ-007.json',
    },
    {
      id: 'PQ-008',
      title: 'Validation Rule Firing',
      requirement: 'FRS-VAL-001',
      cfr: '§11.10(a) — Validation',
      riskLevel: 'Critical',
      preconditions: 'Form with validation rules configured (e.g. range check, required fields)',
      steps: [
        'Enter data that violates a "Block Save" rule (e.g. systolic BP = 500).',
        'Attempt save.',
        'Verify save blocked with error message.',
        'Enter data that violates a "Query" rule.',
        'Save.',
        'Verify auto-query created on the field.',
      ],
      expectedResult:
        'Block-save rules prevent submission, query-level rules create automatic data queries.',
      evidence: 'See evidence/pq/PQ-008.json',
    },
    {
      id: 'PQ-009',
      title: 'Manual Query Lifecycle',
      requirement: 'FRS-QUERY-001',
      cfr: '§11.10(e) — Audit trails',
      riskLevel: 'High',
      preconditions: 'Form data entered with a discrepancy',
      steps: [
        'DM/monitor creates manual query on a field (POST /api/queries).',
        'CRC/coordinator views query and responds with explanation.',
        'DM reviews response and resolves query.',
        'GET /api/audit for complete query lifecycle.',
      ],
      expectedResult:
        'Full query lifecycle (Open → Answered → Closed) completed with audit trail for each transition.',
      evidence: 'See evidence/pq/PQ-009.json',
    },
    {
      id: 'PQ-010',
      title: 'Data Correction with Reason',
      requirement: 'FRS-DATA-004 / URS-AUDIT-008',
      cfr: '§11.10(e) — Audit trails',
      riskLevel: 'Critical',
      preconditions: 'Saved form data exists',
      steps: [
        'Navigate to saved form.',
        'Modify a field value.',
        'System prompts for reason for change.',
        'Enter reason.',
        'Save.',
        'GET /api/audit.',
        'Verify old value, new value, and reason all captured.',
      ],
      expectedResult:
        'Data corrected, audit trail shows old value, new value, reason, user, and timestamp.',
      evidence: 'See evidence/pq/PQ-010.json',
    },
    {
      id: 'PQ-011',
      title: 'Skip/Branching Logic',
      requirement: 'FRS-FORM-002',
      cfr: '§11.10(a) — Validation',
      riskLevel: 'Medium',
      preconditions:
        'Form with skip logic configured (e.g. "If gender=Male, hide pregnancy fields")',
      steps: [
        'Enter trigger value (e.g. gender=Male).',
        'Verify downstream fields hidden/shown correctly.',
        'Change trigger value.',
        'Verify fields toggle appropriately.',
        'Save form.',
        'Verify only visible field values persisted.',
      ],
      expectedResult:
        'Skip logic correctly shows/hides fields based on trigger values.',
      evidence: 'See evidence/pq/PQ-011.json',
    },
    {
      id: 'PQ-012',
      title: 'Multi-Form Visit Completion',
      requirement: 'FRS-VISIT-002',
      cfr: '§11.10(a) — Validation',
      riskLevel: 'Medium',
      preconditions: 'Visit with multiple assigned forms',
      steps: [
        'Open first form, complete all fields, save.',
        'Open second form, complete all fields, save.',
        'Repeat for all forms in visit.',
        'Verify visit status shows all forms complete.',
      ],
      expectedResult:
        'All forms in visit completed and marked as complete, visit status reflects completion.',
      evidence: 'See evidence/pq/PQ-012.json',
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Section 7 — Review and Approval (PQ-013 to PQ-016)                */
/* ------------------------------------------------------------------ */

function reviewApprovalCases(): PqTestCase[] {
  return [
    {
      id: 'PQ-013',
      title: 'SDV Workflow',
      requirement: 'FRS-SDV-001',
      cfr: '§11.10(a) / §11.10(e) — Validation / Audit trails',
      riskLevel: 'High',
      preconditions: 'Completed forms with source data, monitor logged in',
      steps: [
        'Navigate to SDV dashboard.',
        'Select subject/visit for verification.',
        'Compare eCRF data against source documents.',
        'Mark fields as source-verified.',
        'Verify SDV status updated.',
        'Verify audit trail for SDV actions.',
      ],
      expectedResult:
        'SDV workflow completed, verification status tracked per field/form, all actions audited.',
      evidence: 'See evidence/pq/PQ-013.json',
    },
    {
      id: 'PQ-014',
      title: 'Data Manager Review',
      requirement: 'FRS-DM-001',
      cfr: '§11.10(a) — Validation',
      riskLevel: 'High',
      preconditions: 'Completed forms with some open queries, data_manager logged in',
      steps: [
        'Navigate to data review dashboard.',
        'Review completed forms.',
        'Resolve outstanding queries.',
        'Approve/confirm data as clean.',
        'Verify form status updated.',
      ],
      expectedResult:
        'DM reviews and cleans data, queries resolved, form status reflects DM review.',
      evidence: 'See evidence/pq/PQ-014.json',
    },
    {
      id: 'PQ-015',
      title: 'Investigator E-Signature',
      requirement: 'FRS-ESIG-001 / URS-ESIG-001',
      cfr: '§11.50 / §11.70 — Electronic signatures',
      riskLevel: 'Critical',
      preconditions: 'Completed and reviewed form, investigator logged in',
      steps: [
        'Navigate to form requiring signature.',
        'Initiate e-signature.',
        'Re-enter password for authentication.',
        'Select signature meaning (e.g. "I approve this data").',
        'Confirm signature.',
        'Verify signature recorded with printed name, date/time, and meaning.',
        'Verify signature manifestation displayed on form.',
      ],
      expectedResult:
        'E-signature completed with full Part 11 compliance (name, date, meaning, re-auth), manifestation visible.',
      evidence: 'See evidence/pq/PQ-015.json',
    },
    {
      id: 'PQ-016',
      title: 'Form Sign-Off Workflow',
      requirement: 'FRS-ESIG-002',
      cfr: '§11.50(b) — Signature manifestations',
      riskLevel: 'High',
      preconditions: 'Completed form',
      steps: [
        'Complete form data entry.',
        'Submit for review.',
        'Sign with e-signature.',
        'Verify form status changes to "Signed".',
        'Verify signature manifestation visible on form view.',
        'Verify GET response includes signature details.',
      ],
      expectedResult:
        'Form progresses through sign-off workflow, status is "Signed", signature manifestation displayed.',
      evidence: 'See evidence/pq/PQ-016.json',
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Section 8 — Data Closure (PQ-017 to PQ-020)                      */
/* ------------------------------------------------------------------ */

function dataClosureCases(): PqTestCase[] {
  return [
    {
      id: 'PQ-017',
      title: 'Casebook Freeze',
      requirement: 'FRS-LOCK-001',
      cfr: '§11.10(a) / §11.10(e) — Validation / Audit trails',
      riskLevel: 'Critical',
      preconditions: 'Subject with completed and signed forms, DM logged in',
      steps: [
        'POST /api/data-locks to freeze subject casebook.',
        'Attempt to edit frozen form data.',
        'Verify edit rejected (403/409).',
        'Verify unfreeze is possible through proper workflow.',
        'Verify audit trail for freeze action.',
      ],
      expectedResult:
        'Frozen casebook blocks edits, unfreeze available via workflow, all actions audited.',
      evidence: 'See evidence/pq/PQ-017.json',
    },
    {
      id: 'PQ-018',
      title: 'Casebook Lock',
      requirement: 'FRS-LOCK-002',
      cfr: '§11.10(a) / §11.10(e) — Validation / Audit trails',
      riskLevel: 'Critical',
      preconditions: 'Frozen subject casebook',
      steps: [
        'POST /api/data-locks to escalate to full lock.',
        'Attempt any modification (edit, query, new entry).',
        'Verify all rejected.',
        'Verify lock is more restrictive than freeze.',
      ],
      expectedResult:
        'Locked casebook blocks all modifications including queries and new data entry.',
      evidence: 'See evidence/pq/PQ-018.json',
    },
    {
      id: 'PQ-019',
      title: 'Study Database Lock',
      requirement: 'FRS-LOCK-003',
      cfr: '§11.10(a) — Validation',
      riskLevel: 'Critical',
      preconditions: 'All subjects in study have completed data, DM logged in',
      steps: [
        'Initiate study-level database lock.',
        'Verify all subject casebooks locked.',
        'Verify no data entry possible for any subject.',
        'Verify export capability remains available.',
      ],
      expectedResult:
        'Study-wide lock applied to all subjects, data frozen for analysis, export still functional.',
      evidence: 'See evidence/pq/PQ-019.json',
    },
    {
      id: 'PQ-020',
      title: 'Final Data Export',
      requirement: 'FRS-EXPORT-001',
      cfr: '§11.10(b) — Record copying',
      riskLevel: 'Critical',
      preconditions: 'Locked study database',
      steps: [
        'Initiate complete study data export.',
        'Verify export includes all form data.',
        'Verify export includes audit trails.',
        'Verify export includes query history.',
        'Verify export includes e-signature records.',
        'Verify export includes visit completion status.',
        'Validate export completeness against known record counts.',
      ],
      expectedResult:
        'Complete study data exported with all metadata, audit trails, queries, signatures, verifiable completeness.',
      evidence: 'See evidence/pq/PQ-020.json',
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Section 9 — Archive and Recovery (PQ-021 to PQ-022)               */
/* ------------------------------------------------------------------ */

function archiveRecoveryCases(): PqTestCase[] {
  return [
    {
      id: 'PQ-021',
      title: 'Backup Execution',
      requirement: 'FRS-BACKUP-001',
      cfr: 'HIPAA §164.308(a)(7) / §164.312(a)(2)(iv) — Contingency plan / Encryption',
      riskLevel: 'Critical',
      preconditions: 'System with data',
      steps: [
        'Trigger backup execution (manual or scheduled).',
        'Verify backup file created.',
        'Verify file size is non-zero.',
        'Verify AES-256 encryption applied (file is not readable as plaintext).',
        'Verify backup metadata recorded (timestamp, size, encryption status).',
      ],
      expectedResult:
        'Encrypted backup file created with AES-256, metadata logged, file integrity verified.',
      evidence: 'See evidence/pq/PQ-021.json',
    },
    {
      id: 'PQ-022',
      title: 'Data Retrieval from Archive',
      requirement: 'FRS-BACKUP-002',
      cfr: 'HIPAA §164.308(a)(7) — Contingency plan',
      riskLevel: 'Critical',
      preconditions: 'Backup file from PQ-021',
      steps: [
        'Initiate data retrieval/restore from backup.',
        'Verify decryption succeeds.',
        'Verify all records present (subjects, forms, visits).',
        'Verify audit trail records intact.',
        'Verify e-signatures intact and verifiable.',
        'Compare record counts against pre-backup counts.',
      ],
      expectedResult:
        'All data, audit trails, and signatures recoverable from encrypted backup with full integrity.',
      evidence: 'See evidence/pq/PQ-022.json',
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Generator entry point                                             */
/* ------------------------------------------------------------------ */

export function generate(outputDir: string, _workspaceRoot: string): void {
  const allCases: PqTestCase[][] = [
    studySetupCases(),
    subjectEnrollmentCases(),
    dataEntryQueryCases(),
    reviewApprovalCases(),
    dataClosureCases(),
    archiveRecoveryCases(),
  ];

  const sectionTitles = [
    'Study Setup',
    'Subject Enrollment',
    'Data Entry and Queries',
    'Review and Approval',
    'Data Closure',
    'Archive and Recovery',
  ];

  const tocEntries: SectionEntry[] = [
    { level: 1, title: 'Objective' },
    { level: 1, title: 'Scope' },
    { level: 1, title: 'Test Environment' },
  ];
  for (const title of sectionTitles) {
    tocEntries.push({ level: 1, title });
  }
  tocEntries.push({ level: 1, title: 'Acceptance Criteria' });
  tocEntries.push({ level: 1, title: 'Deviations' });
  tocEntries.push({ level: 1, title: 'Approval Signatures' });

  let content = '';

  content += documentHeader({
    title: 'Performance Qualification Protocol',
    documentId: DOC_ID,
    version: '1.0',
    date: new Date().toISOString().split('T')[0],
    system: SYSTEM_INFO.fullName,
    classification: 'Regulatory — 21 CFR Part 11 Validation',
  });

  content += tableOfContents(tocEntries);
  content += hr();

  /* Section 1 — Objective */
  content += section(2, 'Objective');
  content += 'This Performance Qualification (PQ) protocol verifies that ' +
    `${SYSTEM_INFO.fullName} v${SYSTEM_INFO.version} ` +
    'performs end-to-end clinical workflows correctly in the production-equivalent ' +
    'environment under conditions that approximate real-world use.\n\n';
  content += 'PQ establishes documented evidence that the system consistently produces ' +
    'results meeting predetermined acceptance criteria when operated by trained ' +
    'personnel following standard operating procedures.\n\n';

  /* Section 2 — Scope */
  content += section(2, 'Scope');
  content += 'This protocol covers end-to-end testing of clinical workflows from study ' +
    'setup through data closure, including:\n\n';
  content += '- Study creation and multi-tab configuration\n';
  content += '- Subject enrollment and visit schedule generation\n';
  content += '- eCRF data entry, validation rule firing, and skip logic\n';
  content += '- Query lifecycle management (auto and manual)\n';
  content += '- Source data verification and data manager review\n';
  content += '- Electronic signatures and form sign-off\n';
  content += '- Data locks (casebook freeze, casebook lock, study database lock)\n';
  content += '- Final data export with completeness verification\n';
  content += '- Backup execution and data recovery\n\n';
  content += `**Applicable regulations:** ${REGULATORY_SCOPE.part11Applicable ? '21 CFR Part 11' : ''}` +
    `${REGULATORY_SCOPE.hipaaApplicable ? ', HIPAA Security Rule' : ''}\n\n`;

  /* Section 3 — Test Environment */
  content += section(2, 'Test Environment');
  content += markdownTable(
    ['Component', 'Detail'],
    [
      ['System', SYSTEM_INFO.fullName],
      ['Version', SYSTEM_INFO.version],
      ['API URL', SYSTEM_INFO.environments.production.apiUrl],
      ['Frontend URL', SYSTEM_INFO.environments.production.frontendUrl],
      ['Database Host', SYSTEM_INFO.environments.production.databaseHost],
      ['Backend', `${SYSTEM_INFO.architecture.backend.name} (${SYSTEM_INFO.architecture.backend.version})`],
      ['Frontend', `${SYSTEM_INFO.architecture.frontend.name} (${SYSTEM_INFO.architecture.frontend.version})`],
      ['Database', `${SYSTEM_INFO.architecture.database.name} (${SYSTEM_INFO.architecture.database.version})`],
      ['Hosting', SYSTEM_INFO.infrastructure.hosting],
      ['Containerization', SYSTEM_INFO.infrastructure.containerization],
    ],
  );
  content += '\n';

  /* Test Case Summary Table */
  const flatCases = allCases.flat();
  content += markdownTable(
    ['Section', 'Test Cases', 'IDs'],
    sectionTitles.map((title, i) => {
      const cases = allCases[i];
      return [title, String(cases.length), `${cases[0].id} – ${cases[cases.length - 1].id}`];
    }),
  );
  content += `\n**Total test cases:** ${flatCases.length}\n\n`;
  content += hr();

  /* Sections 4–9 — Test Cases */
  for (let i = 0; i < sectionTitles.length; i++) {
    content += section(2, sectionTitles[i]);
    for (const tc of allCases[i]) {
      content += pqTestCaseBlock(tc);
    }
    content += hr();
  }

  /* Acceptance Criteria */
  content += section(2, 'Acceptance Criteria');
  content += '- All **Critical** and **High** risk test cases MUST pass.\n';
  content += '- Overall pass rate must be **95% or higher** across all test cases.\n';
  content += '- Any failed Critical test case requires immediate remediation and re-test before approval.\n';
  content += '- Any failed High test case requires documented deviation with impact assessment.\n';
  content += '- Failed Medium/Low test cases must be documented with remediation timeline.\n\n';

  content += markdownTable(
    ['Metric', 'Value'],
    [
      ['Total Test Cases', String(flatCases.length)],
      ['Critical Cases', String(flatCases.filter(c => c.riskLevel === 'Critical').length)],
      ['High Cases', String(flatCases.filter(c => c.riskLevel === 'High').length)],
      ['Medium Cases', String(flatCases.filter(c => c.riskLevel === 'Medium').length)],
      ['Low Cases', String(flatCases.filter(c => c.riskLevel === 'Low').length)],
      ['Passed', '_[To be completed after execution]_'],
      ['Failed', '_[To be completed after execution]_'],
      ['Not Tested', '_[To be completed after execution]_'],
      ['Overall Disposition', '_[APPROVED / APPROVED WITH DEVIATIONS / REJECTED]_'],
    ],
  );
  content += '\n';

  /* Deviations */
  content += section(2, 'Deviations');
  content += markdownTable(
    ['ID', 'Test Case', 'Description', 'Impact', 'Resolution', 'Status'],
    [
      ['DEV-001', '_[Test ID]_', '_[Description of deviation]_', '_[Impact assessment]_', '_[Resolution plan]_', '_[Open/Closed]_'],
    ],
  );
  content += '\n';

  /* Approval Signatures */
  content += approvalBlock([
    'QA Manager',
    'Clinical Operations Director',
    'System Owner',
    'Validation Lead',
  ]);

  const meta = getDocumentMeta(outputDir);
  content = stampDocument(content, meta);

  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, '09-pq-protocol.md');
  fs.writeFileSync(outPath, content, 'utf-8');
}
