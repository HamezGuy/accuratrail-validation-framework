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

type TrainingLevel = 'Required' | 'Recommended' | 'N/A';

interface TrainingRole {
  name: string;
  matrix: TrainingLevel[];
}

const TRAINING_TOPICS = [
  'System Use',
  'SOPs',
  'Part 11',
  'E-Signatures',
  'HIPAA / Security',
  'Data Entry',
  'Audit Trail',
  'Role-Specific Tasks',
];

const TRAINING_ROLES: TrainingRole[] = [
  {
    name: 'Developer / Maintainer',
    matrix: ['Required', 'Required', 'Required', 'Recommended', 'Required', 'Recommended', 'Required', 'Required'],
  },
  {
    name: 'QA / Validation',
    matrix: ['Required', 'Required', 'Required', 'Required', 'Required', 'Recommended', 'Required', 'Required'],
  },
  {
    name: 'System Admin',
    matrix: ['Required', 'Required', 'Required', 'Recommended', 'Required', 'N/A', 'Required', 'Required'],
  },
  {
    name: 'Support Staff',
    matrix: ['Required', 'Recommended', 'Recommended', 'N/A', 'Required', 'N/A', 'Recommended', 'Required'],
  },
  {
    name: 'Investigator / Site User',
    matrix: ['Required', 'Required', 'Recommended', 'Required', 'Required', 'Required', 'Recommended', 'Required'],
  },
  {
    name: 'Monitor / CRA',
    matrix: ['Required', 'Required', 'Recommended', 'Required', 'Required', 'Recommended', 'Required', 'Required'],
  },
  {
    name: 'Sponsor / Data Manager',
    matrix: ['Required', 'Required', 'Required', 'Required', 'Required', 'Recommended', 'Required', 'Required'],
  },
  {
    name: 'HIPAA Workforce',
    matrix: ['Recommended', 'Recommended', 'Recommended', 'N/A', 'Required', 'N/A', 'Recommended', 'N/A'],
  },
];

export function generate(outputDir: string, _workspaceRoot: string): void {
  const toc = tableOfContents([
    { level: 1, title: 'Purpose' },
    { level: 1, title: 'Training Requirements by Role' },
    { level: 1, title: 'Training Delivery Methods' },
    { level: 1, title: 'Training Record Requirements' },
    { level: 1, title: 'Refresher Training Schedule' },
    { level: 1, title: 'Training Completion Template' },
    { level: 1, title: 'Approval Signatures' },
  ]);

  let content = '';

  content += documentHeader({
    title: 'Training Requirements Matrix',
    documentId: `TRN-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: 'AccuraTrial Electronic Data Capture System',
    classification: 'Confidential — Regulatory',
  });

  content += toc + '\n';
  content += hr();

  // Section 1: Purpose
  content += section(2, 'Purpose');
  content += 'This Training Requirements Matrix defines the training requirements for all roles that interact with ';
  content += 'the AccuraTrial EDC System. Training ensures that:\n\n';
  content += '- Users understand the system\'s intended use and their responsibilities\n';
  content += '- Users are qualified to perform their assigned tasks per 21 CFR Part 11 (11.10(i))\n';
  content += '- Workforce members understand HIPAA security requirements for ePHI protection\n';
  content += '- All training is documented per regulatory requirements (ICH E6(R2), 21 CFR 11)\n\n';
  content += 'Training must be completed **before** a user is granted production system access. ';
  content += 'Evidence of training completion must be retained for the duration of the user\'s system access plus ';
  content += 'the applicable record retention period.\n\n';
  content += hr();

  // Section 2: Training Requirements by Role
  content += section(2, 'Training Requirements by Role');
  content += 'The following matrix defines training requirements for each role. ';
  content += '**Required** training must be completed before production access. ';
  content += '**Recommended** training should be completed within 30 days of access. ';
  content += '**N/A** indicates the topic is not applicable to the role.\n\n';

  const matrixHeaders = ['Role', ...TRAINING_TOPICS];
  const matrixRows: string[][] = TRAINING_ROLES.map((role) => [
    `**${role.name}**`,
    ...role.matrix,
  ]);

  content += markdownTable(matrixHeaders, matrixRows);
  content += '\n';

  content += section(3, 'Training Topic Descriptions');

  content += '**System Use:** General system navigation, login/logout, password management, ';
  content += 'basic functionality overview, and understanding of system architecture.\n\n';

  content += '**SOPs:** Review of all Standard Operating Procedures applicable to the user\'s role. ';
  content += 'Users must acknowledge understanding of each applicable SOP.\n\n';

  content += '**Part 11:** Overview of 21 CFR Part 11 requirements for electronic records and electronic signatures. ';
  content += 'Covers the user\'s responsibilities for data integrity, audit trail awareness, and compliance.\n\n';

  content += '**E-Signatures:** Training on electronic signature procedures including when signatures are required, ';
  content += 'the meaning of an electronic signature (legally binding equivalent of handwritten), ';
  content += 'and the re-authentication process.\n\n';

  content += '**HIPAA / Security:** HIPAA Security Rule awareness including ePHI handling, ';
  content += 'access controls, breach reporting procedures, and workforce security responsibilities.\n\n';

  content += '**Data Entry:** Training on eCRF data entry procedures including validation rules, ';
  content += 'data correction procedures (with reason for change), query response, and data lock awareness.\n\n';

  content += '**Audit Trail:** Understanding of audit trail purpose, what is recorded, how to review audit trails, ';
  content += 'and the importance of immutability for regulatory compliance.\n\n';

  content += '**Role-Specific Tasks:** Training on tasks unique to the user\'s role (e.g., study setup for admins, ';
  content += 'SDV workflow for monitors, randomization management for data managers).\n\n';
  content += hr();

  // Section 3: Training Delivery Methods
  content += section(2, 'Training Delivery Methods');
  content += 'Training may be delivered via the following methods:\n\n';

  content += markdownTable(
    ['Method', 'Description', 'Applicable Topics', 'Documentation'],
    [
      ['Instructor-Led (Live)', 'In-person or virtual instructor-led training session', 'All topics', 'Attendance roster, training materials, assessment results'],
      ['Self-Paced (Online)', 'Online training modules with knowledge assessment', 'System Use, SOPs, Part 11, HIPAA', 'Completion certificate, assessment score, completion timestamp'],
      ['On-the-Job (OJT)', 'Supervised hands-on training in a training environment', 'Data Entry, Role-Specific Tasks, E-Signatures', 'OJT checklist signed by trainer and trainee'],
      ['Document Review', 'Self-study review of SOPs and documentation with acknowledgment', 'SOPs, Audit Trail', 'Signed acknowledgment form with date'],
      ['Webinar/Recording', 'Recorded training session with assessment', 'Part 11, HIPAA, System Use', 'Viewing confirmation, assessment results'],
    ],
  );
  content += '\n';
  content += hr();

  // Section 4: Training Record Requirements
  content += section(2, 'Training Record Requirements');
  content += 'The following information must be documented for each training event:\n\n';
  content += '1. **Trainee Information:** Full name, user ID, role, department/organization\n';
  content += '2. **Training Event:** Training topic, training module/course ID, delivery method\n';
  content += '3. **Completion Evidence:** Date of completion, assessment score (if applicable), pass/fail status\n';
  content += '4. **Trainer Information:** Trainer name and qualifications (for instructor-led training)\n';
  content += '5. **Acknowledgment:** Trainee signature or electronic confirmation of completion\n';
  content += '6. **Expiration:** Date when refresher training is due\n\n';

  content += section(3, 'Record Retention');
  content += '- Training records must be retained for the **duration of the employee\'s system access** plus **6 years** (per HIPAA 45 CFR 164.530(j)).\n';
  content += '- If the system is used for clinical trials, training records must be retained for the longer of the HIPAA retention period or the applicable clinical trial record retention period (**15 years** per 21 CFR 312.62).\n';
  content += '- Training records are regulated records subject to audit trail requirements.\n\n';
  content += hr();

  // Section 5: Refresher Training Schedule
  content += section(2, 'Refresher Training Schedule');
  content += 'Refresher training ensures ongoing competence and awareness of regulatory requirements:\n\n';

  content += markdownTable(
    ['Training Topic', 'Refresher Frequency', 'Trigger Events'],
    [
      ['System Use', 'Annual', 'Major system upgrade, significant UI changes'],
      ['SOPs', 'Annual or upon SOP revision', 'New SOP version, role change'],
      ['Part 11', 'Annual', 'Regulatory guidance updates, audit findings'],
      ['E-Signatures', 'Annual', 'Process changes, audit findings'],
      ['HIPAA / Security', 'Annual', 'Security incidents, policy changes, breach events'],
      ['Data Entry', 'Annual', 'New form types, validation rule changes, data quality issues'],
      ['Audit Trail', 'Annual', 'Process changes, audit findings'],
      ['Role-Specific Tasks', 'Annual or upon role change', 'New functionality, role reassignment'],
    ],
  );
  content += '\n';

  content += '**Additional Retraining Triggers:**\n\n';
  content += '- Security incident involving the trainee or their role\n';
  content += '- Repeated data quality issues or SOP non-compliance\n';
  content += '- Significant system changes affecting the user\'s workflow\n';
  content += '- Regulatory audit findings requiring remedial training\n';
  content += '- Extended absence (> 90 days) from system use\n\n';
  content += hr();

  // Section 6: Training Completion Template
  content += section(2, 'Training Completion Template');
  content += 'Use the following template to record individual training completion:\n\n';

  content += markdownTable(
    ['Field', 'Value'],
    [
      ['Trainee Name', '________________________'],
      ['User ID', '________________________'],
      ['Role', '________________________'],
      ['Organization / Site', '________________________'],
      ['Training Date', '____/____/________'],
    ],
  );
  content += '\n';

  content += section(3, 'Training Modules Completed');
  content += markdownTable(
    ['#', 'Training Topic', 'Module/Course ID', 'Delivery Method', 'Assessment Score', 'Pass/Fail', 'Date Completed', 'Refresher Due'],
    [
      ['1', 'System Use', '', '', '', '[ ] Pass / [ ] Fail', '', ''],
      ['2', 'SOPs', '', '', '', '[ ] Pass / [ ] Fail', '', ''],
      ['3', 'Part 11', '', '', '', '[ ] Pass / [ ] Fail', '', ''],
      ['4', 'E-Signatures', '', '', '', '[ ] Pass / [ ] Fail', '', ''],
      ['5', 'HIPAA / Security', '', '', '', '[ ] Pass / [ ] Fail', '', ''],
      ['6', 'Data Entry', '', '', '', '[ ] Pass / [ ] Fail', '', ''],
      ['7', 'Audit Trail', '', '', '', '[ ] Pass / [ ] Fail', '', ''],
      ['8', 'Role-Specific Tasks', '', '', '', '[ ] Pass / [ ] Fail', '', ''],
    ],
  );
  content += '\n';

  content += section(3, 'Acknowledgment');
  content += 'I acknowledge that I have completed the training modules listed above and understand my responsibilities ';
  content += 'for using the AccuraTrial EDC System in compliance with 21 CFR Part 11 and HIPAA requirements.\n\n';

  content += markdownTable(
    ['Role', 'Name', 'Signature', 'Date'],
    [
      ['Trainee', '_________________', '_________________', '____/____/____'],
      ['Trainer / Supervisor', '_________________', '_________________', '____/____/____'],
    ],
  );
  content += '\n';
  content += hr();

  // Approval Signatures
  content += approvalBlock([
    'Quality Assurance Lead',
    'Training Manager',
    'Project Manager',
  ]);

  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '15-training-matrix.md'), content);
}
