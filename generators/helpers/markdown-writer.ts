import { ICH_E6_R3, E6_R3_SECTION_STATUS } from '../../config/regulatory-scope';
import { evidenceNoticeLines, registryCounts, registryCountsText } from '../../runners/evidence-capture';

export interface DocumentHeaderOptions {
  title: string;
  documentId: string;
  version: string;
  date: string;
  system: string;
  classification: string;
}

export interface TestCaseOptions {
  id: string;
  title: string;
  requirement?: string;
  cfr?: string;
  steps: string[];
  expectedResult: string;
  actualResult?: string;
  passFail?: 'Pass' | 'Fail' | 'Not Tested';
  evidence?: string;
}

export interface SectionEntry {
  level: number;
  title: string;
}

export function documentHeader(opts: DocumentHeaderOptions): string {
  const lines: string[] = [
    // A synthetic or development run says so before anything else (VD-3).
    ...evidenceNoticeLines(),
    `# ${opts.title}`,
    '',
    '| Field | Value |',
    '|-------|-------|',
    `| Document ID | ${opts.documentId} |`,
    `| Version | ${opts.version} |`,
    `| Date | ${opts.date} |`,
    `| System | ${opts.system} |`,
    `| Classification | ${opts.classification} |`,
    // Every document cites the guideline through config/regulatory-scope.ts,
    // whose section numbers QA has not yet verified.
    e6r3StatusRow(),
    '',
    '---',
    '',
  ];
  return lines.join('\n');
}

/** The registry cases of a category's rows, counted apart from its bookkeeping rows (IR-416); generate.ts
 * reaches the counts here because the offline CLI fixture replaces the runner modules it requires. */
export function registryCasesText(rows: ReadonlyArray<{ testCaseId: string; passed: boolean }>): string {
  return registryCountsText(registryCounts(rows));
}

/** The metadata row that states the verification status of every ICH E6(R3) section reference. */
export function e6r3StatusRow(): string {
  return `| ${ICH_E6_R3.citation} Section References | ${E6_R3_SECTION_STATUS} |`;
}

/** The opening lines of evidence/MASTER-EVIDENCE-INDEX.md, which generate.ts writes after
 * the runners: the run's notices, the title and its metadata, the E6(R3) status row included. */
export function masterEvidenceIndexHeader(generatedAt: string): string[] {
  return [
    ...evidenceNoticeLines(),
    '# Master Test Execution Evidence Index',
    '',
    '| Field | Value |',
    '|-------|-------|',
    `| Generated | ${generatedAt} |`,
    '| System | AccuraTrial Electronic Data Capture System |',
    '| Classification | Confidential — Regulatory |',
    e6r3StatusRow(),
    '',
    '---',
    '',
  ];
}

export function markdownTable(headers: string[], rows: string[][]): string {
  if (headers.length === 0) {
    return '';
  }

  const headerRow = `| ${headers.join(' | ')} |`;
  const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
  const dataRows = rows.map(
    (row) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`
  );

  return [headerRow, separatorRow, ...dataRows, ''].join('\n');
}

export function testCaseBlock(opts: TestCaseOptions): string {
  const lines: string[] = [
    `### ${opts.id}: ${opts.title}`,
    '',
  ];

  if (opts.requirement) {
    lines.push(`**Requirement:** ${opts.requirement}  `);
  }
  if (opts.cfr) {
    lines.push(`**CFR Reference:** ${opts.cfr}  `);
  }
  if (opts.requirement || opts.cfr) {
    lines.push('');
  }

  lines.push('**Test Steps:**', '');
  opts.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`);
  });
  lines.push('');

  lines.push(`**Expected Result:** ${opts.expectedResult}  `);

  if (opts.actualResult !== undefined) {
    lines.push(`**Actual Result:** ${opts.actualResult}  `);
  }

  const status = opts.passFail ?? 'Not Tested';
  lines.push(`**Status:** ${statusBadge(status)}  `);

  if (opts.evidence !== undefined) {
    lines.push(`**Evidence:** ${opts.evidence}  `);
  }

  lines.push('');
  return lines.join('\n');
}

export function section(level: number, title: string, anchor?: string): string {
  const clampedLevel = Math.max(1, Math.min(level, 6));
  const hashes = '#'.repeat(clampedLevel);
  const anchorTag = anchor
    ? `<a id="${anchor}"></a>\n`
    : '';
  return `${anchorTag}${hashes} ${title}\n\n`;
}

export function riskBadge(level: 'Critical' | 'High' | 'Medium' | 'Low'): string {
  const icons: Record<typeof level, string> = {
    Critical: '🔴',
    High: '🟠',
    Medium: '🟡',
    Low: '🟢',
  };
  return `**${icons[level]} ${level}**`;
}

export function statusBadge(status: 'Pass' | 'Fail' | 'Not Tested' | 'N/A'): string {
  const icons: Record<typeof status, string> = {
    Pass: '✅',
    Fail: '❌',
    'Not Tested': '⬜',
    'N/A': '➖',
  };
  return `${icons[status]} ${status}`;
}

/** Approval is a person's act recorded in the eTMF (TA3 plan VAL-1): the
 * framework never signs a document and prints no signature lines. */
export const APPROVAL_STATEMENT = 'Approval of this document is recorded in the eTMF as a governance decision on the '
  + 'filing of this package (TMF-FILING.md). This file carries no signature.';

export function approvalBlock(roles: string[]): string {
  const lines: string[] = [
    '## Approval Signatures',
    '',
    APPROVAL_STATEMENT,
    '',
    '| Role | Approval |',
    '|------|----------|',
  ];

  for (const role of roles) {
    lines.push(`| ${role} | To approve |`);
  }

  lines.push('');
  return lines.join('\n');
}

export function hr(): string {
  return '---\n\n';
}

export function tableOfContents(sections: SectionEntry[]): string {
  const lines: string[] = ['## Table of Contents', ''];

  for (const entry of sections) {
    const indent = '  '.repeat(Math.max(0, entry.level - 1));
    const slug = entry.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
    lines.push(`${indent}- [${entry.title}](#${slug})`);
  }

  lines.push('');
  return lines.join('\n');
}
