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
    { level: 1, title: 'Instructions for Use' },
    { level: 1, title: 'Deviation Log' },
    { level: 1, title: 'Deviation Classification Criteria' },
    { level: 1, title: 'Escalation Procedures' },
    { level: 1, title: 'Approval Signatures' },
  ]);

  let content = '';

  content += documentHeader({
    title: 'Deviation Log',
    documentId: `DEV-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: 'AccuraTrial Electronic Data Capture System',
    classification: 'Confidential — Regulatory',
  });

  content += toc + '\n';
  content += hr();

  // Section 1: Purpose
  content += section(2, 'Purpose');
  content += 'This Deviation Log records all deviations identified during the validation of the AccuraTrial EDC System. ';
  content += 'Each deviation is assessed for severity, root cause, and corrective action. ';
  content += 'All deviations must be tracked to closure or formal risk acceptance before the system can be released for production use.\n\n';
  content += 'This document is a controlled record subject to 21 CFR Part 11 requirements for electronic records.\n\n';
  content += hr();

  // Section 2: Instructions for Use
  content += section(2, 'Instructions for Use');
  content += '1. **Log every deviation** identified during IQ, OQ, and PQ test execution.\n';
  content += '2. **Assign a unique Deviation ID** using the format `DEV-YYYY-NNN` (e.g., DEV-2026-001).\n';
  content += '3. **Record the Test Case ID** that triggered the deviation (e.g., IQ-001, OQ-015, PQ-003).\n';
  content += '4. **Classify severity** using the criteria defined in Section 4.\n';
  content += '5. **Perform root cause analysis** — identify why the deviation occurred.\n';
  content += '6. **Assess impact** — determine what system functions, data integrity, or compliance requirements are affected.\n';
  content += '7. **Define corrective action** — specify what will be done to resolve the deviation.\n';
  content += '8. **Track to resolution** — update status as the deviation progresses through investigation and closure.\n';
  content += '9. **Obtain approval** for each closed deviation from the designated reviewer.\n';
  content += '10. **Critical and High deviations** are release-blocking and must be closed or have an approved CAPA before release.\n\n';
  content += hr();

  // Section 3: Deviation Log Table
  content += section(2, 'Deviation Log');

  const headers = [
    'Deviation ID',
    'Test Case ID',
    'Description',
    'Severity',
    'Root Cause',
    'Impact Assessment',
    'Corrective Action',
    'Resolution Date',
    'Status',
    'Approved By',
  ];

  const exampleRows: string[][] = [
    [
      '[EXAMPLE] DEV-2026-001',
      'IQ-005',
      'Database migration script failed to create acc_audit_log index',
      'High',
      'Missing IF NOT EXISTS clause in migration SQL',
      'Audit trail queries may be slow; no data loss but performance impact on compliance reporting',
      'Added IF NOT EXISTS to index creation; re-ran migration successfully',
      '2026-XX-XX',
      'Closed',
      'QA Lead',
    ],
    [
      '[EXAMPLE] DEV-2026-002',
      'OQ-012',
      'E-signature re-authentication accepted expired session token',
      'Critical',
      'Token expiry check compared UTC timestamp against local timezone',
      'Users could potentially sign records without valid re-authentication, violating 21 CFR 11.10(d)',
      'Fixed timezone handling in token validation; added regression test OQ-012b',
      '2026-XX-XX',
      'Closed',
      'QA Lead',
    ],
    [
      '[EXAMPLE] DEV-2026-003',
      'PQ-008',
      'Export PDF missing page numbers on landscape-format CRF reports',
      'Low',
      'PDF library default settings omit page numbers for landscape orientation',
      'Cosmetic issue only; exported data is complete and accurate',
      'Configure PDF library to include page numbers in all orientations',
      '',
      'Open',
      '',
    ],
  ];

  content += markdownTable(headers, exampleRows);
  content += '\n';
  content += '> **Note:** Remove the [EXAMPLE] rows above and replace with actual deviations as they are identified during test execution.\n\n';
  content += hr();

  // Section 4: Deviation Classification Criteria
  content += section(2, 'Deviation Classification Criteria');
  content += 'Each deviation must be classified according to the following severity levels:\n\n';

  content += markdownTable(
    ['Severity', 'Definition', 'Release Impact', 'Examples'],
    [
      [
        '**Critical**',
        'Affects subject safety, data integrity of regulated records, audit trail completeness, electronic signature validity, ePHI security, or access control enforcement',
        'Release-blocking. Must be resolved or have an approved CAPA with risk acceptance before release.',
        'Audit trail not recording changes; e-signature bypass; unauthorized data access; ePHI exposed without authentication',
      ],
      [
        '**High**',
        'Affects important clinical workflows, data quality, reporting accuracy, or security controls, but does not directly compromise subject safety or primary regulated records',
        'Release-blocking. Must be resolved or have an approved CAPA before release.',
        'Query workflow not sending notifications; export missing non-critical fields; role permissions too permissive for non-clinical functions',
      ],
      [
        '**Medium**',
        'Affects non-critical workflows or usability but does not impact regulated records or compliance',
        'Not release-blocking. Should be resolved before next validation cycle.',
        'Dashboard chart displays incorrect date range; non-critical form field alignment issue; slow search performance',
      ],
      [
        '**Low**',
        'Cosmetic or minor usability issue with no impact on regulated records, data integrity, or compliance',
        'Not release-blocking. May be deferred to future release.',
        'Minor UI text typo; tooltip not displaying; column width inconsistency',
      ],
    ],
  );
  content += '\n';
  content += hr();

  // Section 5: Escalation Procedures
  content += section(2, 'Escalation Procedures');
  content += 'The following escalation procedures apply to deviations identified during validation:\n\n';

  content += section(3, 'Immediate Escalation (Critical Deviations)');
  content += '1. **Notify** the QA Lead and Project Manager immediately upon discovery.\n';
  content += '2. **Halt** testing of affected functional area until impact is assessed.\n';
  content += '3. **Document** the deviation in this log within 24 hours of discovery.\n';
  content += '4. **Initiate** a CAPA record (see 11-capa-records.md) if the root cause may affect other system areas.\n';
  content += '5. **Convene** a deviation review meeting within 48 hours.\n';
  content += '6. **Obtain** formal risk acceptance from System Owner if the deviation cannot be resolved before release.\n\n';

  content += section(3, 'Standard Escalation (High Deviations)');
  content += '1. **Notify** the QA Lead within 24 hours of discovery.\n';
  content += '2. **Document** the deviation in this log within 48 hours.\n';
  content += '3. **Assess** whether a CAPA is needed.\n';
  content += '4. **Track** corrective action to completion before release.\n';
  content += '5. **Obtain** QA Lead approval for closure.\n\n';

  content += section(3, 'Routine Process (Medium/Low Deviations)');
  content += '1. **Document** the deviation in this log within one week of discovery.\n';
  content += '2. **Assign** corrective action to appropriate team member.\n';
  content += '3. **Track** to resolution per normal project timeline.\n';
  content += '4. **Close** with QA Lead review.\n\n';

  content += section(3, 'Deviation Review Meeting');
  content += 'A Deviation Review Meeting is held at the following milestones:\n\n';
  content += '- After completion of IQ test execution\n';
  content += '- After completion of OQ test execution\n';
  content += '- After completion of PQ/UAT test execution\n';
  content += '- Before the release gate decision (see 16-release-gate-checklist.md)\n\n';
  content += 'The meeting reviews all open deviations, assesses cumulative risk, and determines whether the release gate criteria are met.\n\n';
  content += hr();

  // Approval Signatures
  content += approvalBlock([
    'Quality Assurance Lead',
    'Project Manager',
    'System Owner',
  ]);

  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '10-deviation-log.md'), content);
}
