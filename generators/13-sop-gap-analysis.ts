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

interface SOPEntry {
  file?: string;
  sopNumber: string;
  title: string;
  version: string;
  directory: string;
}

interface RequiredCategory {
  id: number;
  name: string;
  description: string;
  matchPatterns: RegExp[];
}

const KNOWN_SOPS: SOPEntry[] = [
  { sopNumber: 'SOP-001', title: 'Product Management and Requirements', version: '', directory: 'operational' },
  { sopNumber: 'SOP-002', title: 'Periodic System Review and Revalidation Assessment', version: '', directory: 'operational' },
  { sopNumber: 'SOP-003', title: 'Code Review Process', version: '', directory: 'operational' },
  { sopNumber: 'SOP-004', title: 'Testing and Validation', version: '', directory: 'operational' },
  { sopNumber: 'SOP-005', title: 'Change Control Management', version: '', directory: 'operational' },
  { sopNumber: 'SOP-006', title: 'System Validation and Qualification', version: '', directory: 'operational' },
  { sopNumber: 'SOP-007', title: 'Training and Access Control', version: '', directory: 'operational' },
  { sopNumber: 'SOP-008', title: 'Audit Trail and Record Retention', version: '', directory: 'operational' },
  { sopNumber: 'SOP-009', title: 'HIPAA Breach Notification and Incident Response', version: '', directory: 'compliance' },
  { sopNumber: 'SOP-010', title: 'Vendor and Supplier Management', version: '', directory: 'operational' },
  { sopNumber: 'SOP-011', title: 'Local Development Environment Setup', version: '', directory: 'operational' },
  { sopNumber: 'SOP-012', title: 'Running Application from GitHub', version: '', directory: 'operational' },
  { sopNumber: 'SOP-013', title: 'AI Backend Integration Deployment', version: '', directory: 'operational' },
  { sopNumber: 'SOP-014', title: 'System Troubleshooting', version: '', directory: 'operational' },
  { sopNumber: 'SOP-015-compliance', title: 'GxP Compliance and System Training', version: '', directory: 'compliance' },
  { sopNumber: 'SOP-015-operational', title: 'User Management', version: '', directory: 'operational' },
  { sopNumber: 'SOP-016', title: 'Form Creation and Management', version: '', directory: 'operational' },
  { sopNumber: 'SOP-017', title: 'Workflow Management', version: '', directory: 'operational' },
  { sopNumber: 'SOP-018', title: 'Data Lock Management', version: '', directory: 'operational' },
  { sopNumber: 'SOP-019', title: 'Validation Rules', version: '', directory: 'operational' },
  { sopNumber: 'SOP-020', title: 'Query Management', version: '', directory: 'operational' },
  { sopNumber: 'SOP-021', title: 'Electronic Signature', version: '', directory: 'operational' },
  { sopNumber: 'SOP-022', title: 'Data Export', version: '', directory: 'operational' },
  { sopNumber: 'SOP-025', title: 'Study Management', version: '', directory: 'operational' },
  { sopNumber: 'SOP-026', title: 'Patient/Subject Management', version: '', directory: 'operational' },
  { sopNumber: 'SOP-028', title: 'Source Data Verification', version: '', directory: 'operational' },
  { sopNumber: 'SOP-029', title: 'Data Entry', version: '', directory: 'operational' },
  { sopNumber: 'SOP-030', title: 'Randomization', version: '', directory: 'operational' },
  { sopNumber: 'SOP-031', title: 'Reports and Analytics', version: '', directory: 'operational' },
  { sopNumber: 'SOP-032', title: 'Login and Navigation', version: '', directory: 'operational' },
  { sopNumber: 'SOP-033', title: 'Data Migration and System Decommissioning', version: '', directory: 'operational' },
];

const REQUIRED_CATEGORIES: RequiredCategory[] = [
  { id: 1, name: 'Computer System Validation', description: 'SOP governing CSV lifecycle, validation planning, and execution', matchPatterns: [/validation/i, /qualification/i, /csv/i] },
  { id: 2, name: 'Part 11 / Electronic Records', description: 'SOP for managing electronic records per 21 CFR Part 11', matchPatterns: [/part\s*11/i, /electronic\s*record/i, /gxp\s*compliance/i, /21\s*cfr/i] },
  { id: 3, name: 'Electronic Signatures', description: 'SOP for electronic signature use, verification, and administration', matchPatterns: [/electronic\s*signature/i, /e-?signature/i] },
  { id: 4, name: 'Change Control', description: 'SOP for managing changes to validated systems', matchPatterns: [/change\s*control/i, /change\s*management/i] },
  { id: 5, name: 'User Access Management', description: 'SOP for user provisioning, deactivation, and access reviews', matchPatterns: [/user\s*management/i, /access\s*control/i, /training\s*and\s*access/i, /login/i] },
  { id: 6, name: 'Audit Trail Review', description: 'SOP for periodic audit trail review and investigation procedures', matchPatterns: [/audit\s*trail/i, /audit\s*log/i] },
  { id: 7, name: 'Data Correction', description: 'SOP for correcting clinical data with proper audit trail and reason for change', matchPatterns: [/data\s*entry/i, /data\s*correction/i, /query\s*management/i] },
  { id: 8, name: 'Backup and Restore', description: 'SOP for system backup procedures and restore verification', matchPatterns: [/backup/i, /restore/i, /disaster/i, /troubleshooting/i] },
  { id: 9, name: 'Disaster Recovery / Business Continuity', description: 'SOP for system recovery and business continuity in case of catastrophic failure', matchPatterns: [/disaster\s*recovery/i, /business\s*continuity/i, /troubleshooting/i] },
  { id: 10, name: 'Record Retention and Archival', description: 'SOP for retaining and archiving regulated electronic records per retention schedules', matchPatterns: [/record\s*retention/i, /archival/i, /audit\s*trail\s*and\s*record/i] },
  { id: 11, name: 'Incident Response', description: 'SOP for responding to system incidents, errors, and security events', matchPatterns: [/incident/i, /troubleshooting/i] },
  { id: 12, name: 'HIPAA Breach Notification (if ePHI)', description: 'SOP for HIPAA breach identification, assessment, and notification procedures', matchPatterns: [/hipaa/i, /breach/i, /phi/i] },
  { id: 13, name: 'Vendor Management', description: 'SOP for qualifying and managing third-party vendors and service providers', matchPatterns: [/vendor/i, /supplier/i, /third.?party/i] },
  { id: 14, name: 'Training', description: 'SOP for role-based training requirements, delivery, and documentation', matchPatterns: [/training/i, /gxp\s*compliance/i] },
  { id: 15, name: 'Document Control', description: 'SOP for controlling creation, review, approval, distribution, and retirement of regulated documents', matchPatterns: [/document\s*control/i, /product\s*management/i, /code\s*review/i] },
  { id: 16, name: 'Data Migration / Decommissioning', description: 'SOP for migrating data between systems and decommissioning retired systems', matchPatterns: [/data\s*migration/i, /decommission/i] },
  { id: 17, name: 'Periodic Review', description: 'SOP for periodic review of validated systems to ensure continued compliance', matchPatterns: [/periodic.*review/i, /revalidation\s*assessment/i, /system\s*validation\s*and\s*qualification/i] },
];

function loadSOPs(workspaceRoot: string): SOPEntry[] {
  try {
    const collectorPath = path.resolve(__dirname, '..', 'collectors', 'sop-collector');
    const { collectSOPs } = require(collectorPath) as { collectSOPs: (root: string) => SOPEntry[] };
    const collected = collectSOPs(workspaceRoot);
    if (collected.length > 0) {
      return collected;
    }
  } catch { /* fall through to known list */ }
  return KNOWN_SOPS;
}

function matchSOPsToCategory(sops: SOPEntry[], category: RequiredCategory): SOPEntry[] {
  return sops.filter((sop) => {
    const searchText = `${sop.title} ${sop.sopNumber}`;
    return category.matchPatterns.some((pattern) => pattern.test(searchText));
  });
}

function priorityForGap(categoryId: number): string {
  const criticalCategories = [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 14];
  const highCategories = [7, 11, 13, 15, 17];
  if (criticalCategories.includes(categoryId)) return 'Critical';
  if (highCategories.includes(categoryId)) return 'High';
  return 'Medium';
}

export function generate(outputDir: string, workspaceRoot: string): void {
  const sops = loadSOPs(workspaceRoot);

  const toc = tableOfContents([
    { level: 1, title: 'Purpose' },
    { level: 1, title: 'Existing SOPs Inventory' },
    { level: 1, title: 'Gap Analysis' },
    { level: 1, title: 'Gap Remediation Plan' },
    { level: 1, title: 'Approval Signatures' },
  ]);

  let content = '';

  content += documentHeader({
    title: 'SOP Gap Analysis',
    documentId: `SOP-GAP-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: 'AccuraTrial Electronic Data Capture System',
    classification: 'Confidential — Regulatory',
  });

  content += toc + '\n';
  content += hr();

  // Section 1: Purpose
  content += section(2, 'Purpose');
  content += 'This document identifies gaps between the Standard Operating Procedures (SOPs) required for a ';
  content += '21 CFR Part 11 and HIPAA-compliant EDC system and the SOPs that currently exist for the AccuraTrial EDC System.\n\n';
  content += 'The gap analysis covers 17 required SOP categories derived from regulatory requirements (21 CFR Part 11, ';
  content += 'HIPAA Security Rule, ICH E6(R2)) and industry best practices (GAMP 5, ISPE).\n\n';
  content += hr();

  // Section 2: Existing SOPs Inventory
  content += section(2, 'Existing SOPs Inventory');
  content += `**Total SOPs Found:** ${sops.length}\n\n`;

  content += markdownTable(
    ['SOP Number', 'Title', 'Category', 'Version'],
    sops.map((s) => [
      s.sopNumber || '(no number)',
      s.title || '(untitled)',
      s.directory,
      s.version || '—',
    ]),
  );
  content += '\n';
  content += hr();

  // Section 3: Gap Analysis
  content += section(2, 'Gap Analysis');
  content += 'The following table maps each required SOP category to existing SOPs and identifies gaps:\n\n';

  const gapRows: string[][] = [];
  let coveredCount = 0;
  let gapCount = 0;
  let partialCount = 0;

  for (const category of REQUIRED_CATEGORIES) {
    const matches = matchSOPsToCategory(sops, category);
    let status: string;
    let gapDescription: string;
    let priority: string;

    if (matches.length === 0) {
      status = 'GAP';
      gapDescription = `No existing SOP covers ${category.description.toLowerCase()}. A new SOP must be created.`;
      priority = priorityForGap(category.id);
      gapCount++;
    } else {
      const titlesWithNumbers = matches.map((m) => `${m.sopNumber}: ${m.title}`);
      const allPatternsCovered = category.matchPatterns.every((p) =>
        matches.some((m) => p.test(`${m.title} ${m.sopNumber}`))
      );
      const hasDedicatedSop = matches.some((m) => {
        const text = `${m.title} ${m.sopNumber}`;
        const matchCount = category.matchPatterns.filter((p) => p.test(text)).length;
        return matchCount >= Math.ceil(category.matchPatterns.length / 2);
      });
      if (allPatternsCovered || hasDedicatedSop) {
        status = 'Covered';
        gapDescription = 'Fully addressed by existing SOP(s).';
        priority = '—';
        coveredCount++;
      } else {
        status = 'Partial';
        gapDescription = `Existing SOP(s) partially address this category. Review ${titlesWithNumbers.join('; ')} for completeness and update if needed.`;
        priority = 'Medium';
        partialCount++;
      }
    }

    const matchedSops = matches.length > 0
      ? matches.map((m) => `${m.sopNumber}`).join(', ')
      : '—';

    gapRows.push([
      `${category.id}. ${category.name}`,
      status === 'GAP' ? '**GAP**' : status === 'Partial' ? '**Partial**' : 'Covered',
      matchedSops,
      gapDescription,
      priority,
    ]);
  }

  content += markdownTable(
    ['Required Category', 'Status', 'Existing SOP(s)', 'Gap Description', 'Priority'],
    gapRows,
  );
  content += '\n';

  content += section(3, 'Gap Analysis Summary');
  content += markdownTable(
    ['Metric', 'Count'],
    [
      ['Required SOP Categories', String(REQUIRED_CATEGORIES.length)],
      ['Fully Covered', String(coveredCount)],
      ['Partially Covered', String(partialCount)],
      ['Gaps (No Coverage)', String(gapCount)],
    ],
  );
  content += '\n';
  content += hr();

  // Section 4: Gap Remediation Plan
  content += section(2, 'Gap Remediation Plan');
  content += 'The following remediation actions are required to close identified SOP gaps:\n\n';

  content += section(3, 'Critical Priority Gaps');
  content += 'These SOPs must be created or updated **before production release**:\n\n';
  const criticalGaps = gapRows.filter((r) => r[4] === 'Critical' && r[1].includes('GAP'));
  if (criticalGaps.length === 0) {
    content += 'No critical SOP gaps identified.\n\n';
  } else {
    criticalGaps.forEach((row, i) => {
      content += `${i + 1}. **${row[0]}** — ${row[3]}\n`;
    });
    content += '\n';
  }

  content += section(3, 'High Priority Gaps');
  content += 'These SOPs should be created or updated within **30 days of production release**:\n\n';
  const highGaps = gapRows.filter((r) => r[4] === 'High' && r[1].includes('GAP'));
  if (highGaps.length === 0) {
    content += 'No high-priority SOP gaps identified.\n\n';
  } else {
    highGaps.forEach((row, i) => {
      content += `${i + 1}. **${row[0]}** — ${row[3]}\n`;
    });
    content += '\n';
  }

  content += section(3, 'Medium Priority Items');
  content += 'These SOPs should be reviewed and updated within **90 days of production release**:\n\n';
  const mediumItems = gapRows.filter((r) => r[4] === 'Medium');
  if (mediumItems.length === 0) {
    content += 'No medium-priority items identified.\n\n';
  } else {
    mediumItems.forEach((row, i) => {
      content += `${i + 1}. **${row[0]}** — ${row[3]}\n`;
    });
    content += '\n';
  }

  content += hr();

  // Approval Signatures
  content += approvalBlock([
    'Quality Assurance Lead',
    'Regulatory Affairs Manager',
    'Project Manager',
  ]);

  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '13-sop-gap-analysis.md'), content);
}
