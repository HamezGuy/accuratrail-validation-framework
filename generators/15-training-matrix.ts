import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
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

/** Where the package retains the training module's own inspection capture. */
export const TRAINING_EVIDENCE_RELATIVE = path.join('evidence', 'training', 'training-inspection-evidence.json');

interface InspectionTable { table: string; count: number; contentHash: string; rows: Array<{ nativeJson: string; sha256: string }> }

/** The fields of the training module's `training-inspection-evidence/1` this generator reads. */
interface TrainingInspectionEvidence {
  schemaVersion: 'training-inspection-evidence/1';
  nativeStudyId: number;
  scopes: Array<{ studyId: number; siteId?: number }>;
  capturedAt: string;
  observedAt: string;
  authorityHash: string;
  complete: true;
  tables: InspectionTable[];
  gaps: string[];
  limitations: string[];
  evidenceHash: string;
}

type Row = Record<string, unknown>;

/** Structural and per-row byte checks of a training inspection capture. The
 * evidence hash itself belongs to the training module and is reported, not recomputed. */
export function verifyTrainingInspectionEvidence(raw: string, source: string): TrainingInspectionEvidence {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${source} is not JSON.`); }
  const evidence = parsed as TrainingInspectionEvidence;
  if (!evidence || evidence.schemaVersion !== 'training-inspection-evidence/1' || evidence.complete !== true
    || !Array.isArray(evidence.tables) || typeof evidence.evidenceHash !== 'string'
    || typeof evidence.observedAt !== 'string' || !Number.isSafeInteger(evidence.nativeStudyId)) {
    throw new Error(`${source} is not a complete training-inspection-evidence/1 capture.`);
  }
  for (const table of evidence.tables) {
    if (!table || typeof table.table !== 'string' || !Array.isArray(table.rows) || table.count !== table.rows.length) {
      throw new Error(`${source}: table ${table?.table ?? '?'} count differs from its rows.`);
    }
    for (const row of table.rows) {
      if (typeof row.nativeJson !== 'string'
        || createHash('sha256').update(row.nativeJson).digest('hex') !== row.sha256) {
        throw new Error(`${source}: a ${table.table} row differs from its SHA-256.`);
      }
    }
  }
  return evidence;
}

/** Copies a verified capture into the package so the matrix and its source travel together. */
export function retainTrainingInspectionEvidence(sourceFile: string, outputDir: string): string {
  const raw = fs.readFileSync(sourceFile, 'utf-8');
  verifyTrainingInspectionEvidence(raw, sourceFile);
  const target = path.join(outputDir, TRAINING_EVIDENCE_RELATIVE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, raw, 'utf-8');
  return target;
}

function tableRows(evidence: TrainingInspectionEvidence, name: string): Row[] {
  return evidence.tables.filter(table => table.table === name)
    .flatMap(table => table.rows.map(row => JSON.parse(row.nativeJson) as Row));
}

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

interface MatrixModel {
  evidence: TrainingInspectionEvidence;
  courses: Row[];
  roles: string[];
  status: Array<{ role: string; course: Row; assigned: number; completed: number; verified: number; overdue: number }>;
}

function buildModel(evidence: TrainingInspectionEvidence): MatrixModel {
  const courses = tableRows(evidence, 'acc_training_courses')
    .filter(course => course.active !== false)
    .sort((a, b) => text(a.course_code).localeCompare(text(b.course_code)));
  const obligations = tableRows(evidence, 'acc_training_obligations').filter(row => row.status === 'assigned');
  const records = tableRows(evidence, 'acc_training_records');
  const required = (course: Row): string[] => (Array.isArray(course.required_for_roles) ? course.required_for_roles.map(text) : []);
  const roles = [...new Set([...courses.flatMap(required), ...obligations.map(row => text(row.role))])].filter(Boolean).sort();
  const observedAt = Date.parse(evidence.observedAt);
  const status = roles.flatMap(role => courses.map(course => {
    const assigned = obligations.filter(row => row.role === role && row.course_id === course.id);
    const recordFor = (row: Row) => records.find(record => record.user_id === row.user_id && record.course_id === row.course_id);
    const completed = assigned.filter(row => recordFor(row)?.status === 'completed');
    return {
      role, course,
      assigned: assigned.length,
      completed: completed.length,
      verified: completed.filter(row => recordFor(row)?.verified_at).length,
      overdue: assigned.filter(row => recordFor(row)?.status !== 'completed' && Date.parse(text(row.due_at)) < observedAt).length,
    };
  })).filter(row => row.assigned > 0 || required(row.course).includes(row.role));
  return { evidence, courses, roles, status };
}

function loadModel(outputDir: string): MatrixModel | undefined {
  const file = path.join(outputDir, TRAINING_EVIDENCE_RELATIVE);
  if (!fs.existsSync(file)) return undefined;
  return buildModel(verifyTrainingInspectionEvidence(fs.readFileSync(file, 'utf-8'), TRAINING_EVIDENCE_RELATIVE));
}

const NO_EVIDENCE = 'No `training-inspection-evidence/1` capture was supplied to this package (pass `--training-evidence <file>` '
  + 'with a capture exported from the training module). Requirements, completion and verification are therefore not shown, '
  + 'and training qualification under 21 CFR 11.10(i) remains unverified for this package. Nothing here is assumed.\n\n';

export function generate(outputDir: string, _workspaceRoot: string): void {
  const model = loadModel(outputDir);
  const toc = tableOfContents([
    { level: 1, title: 'Purpose' },
    { level: 1, title: 'Evidence Source' },
    { level: 1, title: 'Training Requirements by Role' },
    { level: 1, title: 'Obligation and Completion Status' },
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
  content += 'This Training Requirements Matrix reports the training requirements, obligations, completions and ';
  content += 'verifications that the AccuraTrial training module holds for the study scope under validation. Training ensures that:\n\n';
  content += '- Users understand the system\'s intended use and their responsibilities\n';
  content += '- Users are qualified to perform their assigned tasks per 21 CFR Part 11 (11.10(i))\n';
  content += '- Workforce members understand HIPAA security requirements for ePHI protection\n';
  content += '- All training is documented per regulatory requirements (ICH E6(R2), 21 CFR 11)\n\n';
  content += 'Every requirement and status below is read from the training module\'s retained inspection capture, ';
  content += 'not from a table maintained in this framework.\n\n';
  content += hr();

  // Section 2: Evidence Source
  content += section(2, 'Evidence Source');
  if (!model) {
    content += NO_EVIDENCE;
  } else {
    const { evidence } = model;
    content += markdownTable(['Field', 'Value'], [
      ['Contract', evidence.schemaVersion],
      ['Retained file', TRAINING_EVIDENCE_RELATIVE.split(path.sep).join('/')],
      ['Native study', String(evidence.nativeStudyId)],
      ['Scopes', evidence.scopes.map(scope => `study ${scope.studyId}${scope.siteId ? ` site ${scope.siteId}` : ''}`).join('; ')],
      ['Captured at', evidence.capturedAt],
      ['Observed at', evidence.observedAt],
      ['Authority hash', evidence.authorityHash],
      ['Evidence hash (training module)', evidence.evidenceHash],
      ['Tables', evidence.tables.map(table => `${table.table} (${table.count})`).join(', ')],
    ]);
    content += '\n';
    content += `**Gaps reported by the training module:** ${evidence.gaps.length ? evidence.gaps.join('; ') : 'none'}\n\n`;
    content += `**Limitations:** ${evidence.limitations.length ? evidence.limitations.join('; ') : 'none'}\n\n`;
  }
  content += hr();

  // Section 3: Training Requirements by Role
  content += section(2, 'Training Requirements by Role');
  if (!model) {
    content += NO_EVIDENCE;
  } else if (!model.courses.length || !model.roles.length) {
    content += 'The capture contains no active course or role requirement for this scope.\n\n';
  } else {
    content += '**Required** means the course lists the role in `required_for_roles`. Course version and regulatory ';
    content += 'reference are the training module\'s own values.\n\n';
    content += markdownTable(
      ['Role', ...model.courses.map(course => `${text(course.course_code)} v${text(course.version)}`)],
      model.roles.map(role => [`**${role}**`, ...model.courses.map(course =>
        (Array.isArray(course.required_for_roles) && course.required_for_roles.map(text).includes(role) ? 'Required' : 'Not required'))]),
    );
    content += '\n';
    content += markdownTable(['Course', 'Name', 'Regulatory Reference', 'Passing Score', 'Validity (days)'],
      model.courses.map(course => [text(course.course_code), text(course.course_name), text(course.regulatory_reference) || 'none',
        text(course.passing_score), text(course.validity_period_days) || 'no expiry']));
    content += '\n';
  }
  content += hr();

  // Section 4: Obligation and Completion Status
  content += section(2, 'Obligation and Completion Status');
  if (!model) {
    content += NO_EVIDENCE;
  } else if (!model.status.length) {
    content += 'The capture contains no assigned obligation or role requirement for this scope.\n\n';
  } else {
    content += `Counts are assigned obligations at the capture's observation time (${model.evidence.observedAt}). `;
    content += 'Completed means the matching training record is completed; verified means it also carries a verification time; ';
    content += 'overdue means an incomplete obligation past its due time.\n\n';
    content += markdownTable(['Role', 'Course', 'Assigned', 'Completed', 'Verified', 'Overdue'],
      model.status.map(row => [row.role, text(row.course.course_code), String(row.assigned), String(row.completed),
        String(row.verified), String(row.overdue)]));
    content += '\n';
  }
  content += hr();

  // Section 5: Training Delivery Methods
  content += section(2, 'Training Delivery Methods');
  content += 'Training may be delivered via the following methods:\n\n';

  content += markdownTable(
    ['Method', 'Description', 'Documentation'],
    [
      ['Instructor-Led (Live)', 'In-person or virtual instructor-led training session', 'Attendance roster, training materials, assessment results'],
      ['Self-Paced (Online)', 'Online training modules with knowledge assessment', 'Completion certificate, assessment score, completion timestamp'],
      ['On-the-Job (OJT)', 'Supervised hands-on training in a training environment', 'OJT checklist signed by trainer and trainee'],
      ['Document Review', 'Self-study review of SOPs and documentation with acknowledgment', 'Signed acknowledgment form with date'],
      ['Webinar/Recording', 'Recorded training session with assessment', 'Viewing confirmation, assessment results'],
    ],
  );
  content += '\n';
  content += hr();

  // Section 6: Training Record Requirements
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

  // Section 7: Refresher Training Schedule
  content += section(2, 'Refresher Training Schedule');
  if (!model) {
    content += NO_EVIDENCE;
  } else {
    content += 'Refresher intervals are each course\'s validity period in the training module:\n\n';
    content += markdownTable(['Course', 'Validity (days)'],
      model.courses.map(course => [text(course.course_code), text(course.validity_period_days) || 'no expiry']));
    content += '\n';
  }

  content += '**Additional Retraining Triggers:**\n\n';
  content += '- Security incident involving the trainee or their role\n';
  content += '- Repeated data quality issues or SOP non-compliance\n';
  content += '- Significant system changes affecting the user\'s workflow\n';
  content += '- Regulatory audit findings requiring remedial training\n';
  content += '- Extended absence (> 90 days) from system use\n\n';
  content += hr();

  // Section 8: Training Completion Template
  content += section(2, 'Training Completion Template');
  content += 'Use the following template to record individual training completion outside the training module:\n\n';

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
  const templateCourses = model?.courses.map(course => text(course.course_code)) ?? [];
  content += markdownTable(
    ['#', 'Module/Course ID', 'Delivery Method', 'Assessment Score', 'Pass/Fail', 'Date Completed', 'Refresher Due'],
    (templateCourses.length ? templateCourses : ['', '', '']).map((code, index) =>
      [String(index + 1), code, '', '', '[ ] Pass / [ ] Fail', '', '']),
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

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, '15-training-matrix.md'), content);
}
