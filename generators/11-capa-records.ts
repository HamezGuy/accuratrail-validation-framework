import * as fs from 'fs';
import * as path from 'path';
import {
  documentHeader,
  markdownTable,
  section,
  approvalBlock,
  tableOfContents,
  hr,
} from './helpers/markdown-writer';

const DOC_DATE = new Date().toISOString().split('T')[0];
const DOC_YEAR = new Date().getFullYear();

export function generate(outputDir: string, _workspaceRoot: string): void {
  const toc = tableOfContents([
    { level: 1, title: 'Purpose' },
    { level: 1, title: 'CAPA Process Description' },
    { level: 1, title: 'CAPA Records' },
    { level: 1, title: 'CAPA Effectiveness Review' },
    { level: 1, title: 'Approval Signatures' },
  ]);

  let content = '';

  content += documentHeader({
    title: 'Corrective and Preventive Action (CAPA) Records',
    documentId: `CAPA-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: 'AccuraTrial Electronic Data Capture System',
    classification: 'Confidential — Regulatory',
  });

  content += toc + '\n';
  content += hr();

  // Section 1: Purpose
  content += section(2, 'Purpose');
  content += 'This document records all Corrective and Preventive Actions (CAPAs) arising from deviations ';
  content += 'identified during the validation of the AccuraTrial EDC System. CAPAs ensure that:\n\n';
  content += '- Root causes of deviations are identified and addressed\n';
  content += '- Corrective actions eliminate the immediate problem\n';
  content += '- Preventive actions reduce the likelihood of recurrence\n';
  content += '- All actions are tracked to completion and verified for effectiveness\n\n';
  content += 'This document is a controlled record subject to 21 CFR Part 11 requirements.\n\n';
  content += hr();

  // Section 2: CAPA Process Description
  content += section(2, 'CAPA Process Description');
  content += 'The CAPA process follows these phases:\n\n';

  content += section(3, 'Phase 1: Initiation');
  content += '1. A CAPA is initiated when a deviation is identified that requires formal corrective or preventive action.\n';
  content += '2. CAPAs are mandatory for all **Critical** and **High** severity deviations.\n';
  content += '3. CAPAs may be initiated for **Medium** deviations at the discretion of the QA Lead.\n';
  content += '4. Each CAPA is assigned a unique ID using the format `CAPA-YYYY-NNN`.\n\n';

  content += section(3, 'Phase 2: Root Cause Analysis');
  content += '1. Perform root cause analysis using appropriate techniques (5 Whys, fishbone diagram, fault tree analysis).\n';
  content += '2. Document the root cause in the CAPA record.\n';
  content += '3. Assess whether the root cause affects other system components or validation test cases.\n';
  content += '4. If the root cause is systemic, expand the scope of the CAPA accordingly.\n\n';

  content += section(3, 'Phase 3: Action Planning');
  content += '1. Define **Corrective Action** — what will be done to fix the immediate problem.\n';
  content += '2. Define **Preventive Action** — what will be done to prevent recurrence.\n';
  content += '3. Assign an owner responsible for implementation.\n';
  content += '4. Set a due date for completion.\n';
  content += '5. Obtain QA Lead approval for the action plan.\n\n';

  content += section(3, 'Phase 4: Implementation');
  content += '1. Execute the corrective and preventive actions.\n';
  content += '2. Document all changes made (code changes, configuration changes, SOP updates, etc.).\n';
  content += '3. Re-run affected test cases to verify the corrective action resolves the deviation.\n';
  content += '4. Update the deviation log (10-deviation-log.md) with the resolution.\n\n';

  content += section(3, 'Phase 5: Verification and Closure');
  content += '1. Verify that the corrective action resolved the original deviation.\n';
  content += '2. Verify that the preventive action is in place and effective.\n';
  content += '3. Document verification results in the CAPA record.\n';
  content += '4. Obtain QA Lead approval for closure.\n';
  content += '5. Schedule effectiveness review (Phase 6).\n\n';

  content += section(3, 'Phase 6: Effectiveness Review');
  content += '1. After the next validation cycle or at 90 days (whichever comes first), review CAPA effectiveness.\n';
  content += '2. Confirm that the deviation has not recurred.\n';
  content += '3. Confirm that the preventive action remains in place.\n';
  content += '4. Document the effectiveness review results.\n';
  content += '5. If the CAPA is not effective, re-open and revise the action plan.\n\n';
  content += hr();

  // Section 3: CAPA Records Table
  content += section(2, 'CAPA Records');

  const headers = [
    'CAPA ID',
    'Related Deviation',
    'Description',
    'Root Cause Analysis',
    'Corrective Action',
    'Preventive Action',
    'Due Date',
    'Owner',
    'Status',
    'Verification',
    'Closure Date',
  ];

  const exampleRows: string[][] = [
    [
      '[EXAMPLE] CAPA-2026-001',
      'DEV-2026-002',
      'E-signature re-authentication accepted expired session token due to timezone mismatch',
      'Token expiry comparison used local server time instead of UTC. The auth middleware did not normalize timestamps before comparison.',
      '1. Fixed timezone handling in token validation middleware. 2. Added UTC normalization to all timestamp comparisons in auth flow. 3. Re-ran OQ-012 — now passes.',
      '1. Added unit tests for token expiry edge cases (DST transitions, UTC offset boundaries). 2. Updated coding standards to require UTC for all date/time comparisons. 3. Added linting rule to flag Date() without explicit timezone.',
      '2026-XX-XX',
      'Lead Developer',
      'Closed',
      'OQ-012 re-executed and passed. Unit tests added and passing. Code review confirmed all timestamp comparisons use UTC.',
      '2026-XX-XX',
    ],
    [
      '[EXAMPLE] CAPA-2026-002',
      'DEV-2026-001',
      'Database migration script failed to create acc_audit_log index due to missing IF NOT EXISTS clause',
      'Migration scripts were not written idempotently. The migration runner does not check for existing objects before creating them.',
      '1. Added IF NOT EXISTS to all index creation statements. 2. Re-ran migration successfully.',
      '1. Updated migration template to include IF NOT EXISTS by default. 2. Added migration linting step to CI pipeline that checks for idempotency patterns. 3. Updated SOP-005 (Change Control) with migration writing guidelines.',
      '2026-XX-XX',
      'Lead Developer',
      'Closed',
      'Migration re-executed idempotently on clean and existing databases. CI lint rule verified.',
      '2026-XX-XX',
    ],
  ];

  content += markdownTable(headers, exampleRows);
  content += '\n';
  content += '> **Note:** Remove the [EXAMPLE] rows above and replace with actual CAPA records as they are created.\n\n';
  content += hr();

  // Section 4: CAPA Effectiveness Review
  content += section(2, 'CAPA Effectiveness Review');
  content += 'Each closed CAPA must undergo an effectiveness review to confirm that corrective and preventive ';
  content += 'actions achieved their intended outcome.\n\n';

  content += section(3, 'Effectiveness Review Schedule');
  content += markdownTable(
    ['CAPA ID', 'Closure Date', 'Effectiveness Review Due', 'Review Completed', 'Effective?', 'Reviewer'],
    [
      ['[EXAMPLE] CAPA-2026-001', '2026-XX-XX', '90 days post-closure or next validation cycle', '[ ]', '[ ] Yes / [ ] No', ''],
      ['[EXAMPLE] CAPA-2026-002', '2026-XX-XX', '90 days post-closure or next validation cycle', '[ ]', '[ ] Yes / [ ] No', ''],
    ],
  );
  content += '\n';

  content += section(3, 'Effectiveness Criteria');
  content += 'A CAPA is considered effective when **all** of the following criteria are met:\n\n';
  content += '1. The original deviation has not recurred in subsequent testing or production use.\n';
  content += '2. The corrective action remains in place and has not been reverted.\n';
  content += '3. The preventive action is functioning as designed (e.g., automated tests passing, linting rules active, SOPs updated and followed).\n';
  content += '4. No new deviations have been introduced as a side effect of the CAPA actions.\n\n';

  content += section(3, 'Re-Opening Criteria');
  content += 'A CAPA must be re-opened if any of the following occur:\n\n';
  content += '- The original deviation recurs.\n';
  content += '- The effectiveness review determines that the preventive action is inadequate.\n';
  content += '- New information reveals that the root cause analysis was incorrect or incomplete.\n';
  content += '- Related deviations are discovered that suggest the CAPA scope was insufficient.\n\n';
  content += hr();

  // Approval Signatures
  content += approvalBlock([
    'Quality Assurance Lead',
    'Project Manager',
    'System Owner',
  ]);

  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '11-capa-records.md'), content);
}
