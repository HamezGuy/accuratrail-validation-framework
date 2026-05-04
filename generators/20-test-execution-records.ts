/**
 * Generator 20: Detailed Test Execution Records
 * Reads ALL evidence JSON files and produces a comprehensive test execution record
 * document with per-test-case detail including request/response, procedure, and result.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  documentHeader,
  markdownTable,
  section,
  approvalBlock,
  tableOfContents,
  hr,
  statusBadge,
} from './helpers/markdown-writer';
import { SYSTEM_INFO } from '../config/system-info';

const DOC_DATE = new Date().toISOString().split('T')[0];
const DOC_YEAR = new Date().getFullYear();

type PassFail = 'Pass' | 'Fail' | 'Not Tested';

interface EvidenceRecord {
  testCaseId: string;
  timestamp: string;
  endpoint: string;
  method: string;
  requestBody: unknown;
  responseStatus: number;
  responseBody: unknown;
  passed: boolean;
  notes: string;
  regulatoryRef: string;
  testDescription: string;
  acceptanceCriteria: string;
  durationMs: number;
}

type EvidenceCategory = 'iq' | 'oq' | 'pq' | 'security' | 'dr' | 'performance';

const CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  iq: 'Installation Qualification (IQ)',
  oq: 'Operational Qualification (OQ)',
  pq: 'Performance Qualification (PQ)',
  security: 'Security Testing',
  dr: 'Disaster Recovery Testing',
  performance: 'Performance Testing',
};

const ALL_CATEGORIES: EvidenceCategory[] = ['iq', 'oq', 'pq', 'security', 'dr', 'performance'];

function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.testCaseId === 'string' &&
    typeof obj.passed === 'boolean'
  );
}

function loadCategoryResults(outputDir: string, category: EvidenceCategory): EvidenceRecord[] {
  const filePath = path.join(outputDir, 'evidence', category, `${category}-results.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEvidenceRecord);
  } catch {
    return [];
  }
}

function redactPasswords(body: unknown): unknown {
  if (body === null || body === undefined) return body;
  if (typeof body === 'string') return body;
  if (Array.isArray(body)) return body.map(redactPasswords);
  if (typeof body === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(body as Record<string, unknown>)) {
      if (/password|passwd|secret|token|apiKey/i.test(key)) {
        redacted[key] = '***REDACTED***';
      } else {
        redacted[key] = redactPasswords(val);
      }
    }
    return redacted;
  }
  return body;
}

function safeJsonExcerpt(body: unknown, maxLength: number = 500): string {
  if (body === null || body === undefined) return 'N/A';
  try {
    const str = JSON.stringify(body, null, 2);
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '\n  ... (truncated)';
  } catch {
    return String(body).substring(0, maxLength);
  }
}

function deriveStatus(record: EvidenceRecord): PassFail {
  return record.passed ? 'Pass' : 'Fail';
}

function deriveProcedureSteps(record: EvidenceRecord): string[] {
  const steps: string[] = [];
  if (record.method && record.endpoint) {
    steps.push(`Send ${record.method} request to ${record.endpoint}`);
  }
  if (record.acceptanceCriteria) {
    const criteria = record.acceptanceCriteria.split(/[;,]/).map(c => c.trim()).filter(Boolean);
    for (const criterion of criteria) {
      steps.push(`Verify: ${criterion}`);
    }
  }
  if (steps.length === 0) {
    steps.push('Execute test case per protocol');
    steps.push('Verify acceptance criteria are met');
    steps.push('Record results');
  }
  return steps;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function renderExecutionRecord(record: EvidenceRecord, category: EvidenceCategory): string {
  const status = deriveStatus(record);
  const steps = deriveProcedureSteps(record);
  const redactedReqBody = redactPasswords(record.requestBody);

  let block = '';

  block += `### ${record.testCaseId}: ${record.testDescription || 'Test Case'}\n\n`;

  block += '| Field | Detail |\n';
  block += '|-------|--------|\n';
  block += `| Test Case ID | ${record.testCaseId} |\n`;
  block += `| Regulatory Reference | ${record.regulatoryRef || 'N/A'} |\n`;
  block += `| Description | ${(record.testDescription || 'N/A').replace(/\|/g, '\\|')} |\n`;
  block += `| Acceptance Criteria | ${(record.acceptanceCriteria || 'N/A').replace(/\|/g, '\\|')} |\n`;
  block += `| Test Date | ${record.timestamp || 'N/A'} |\n`;
  block += `| Duration | ${formatDuration(record.durationMs)} |\n`;
  block += '\n';

  block += '**Test Procedure:**\n';
  for (let i = 0; i < steps.length; i++) {
    block += `${i + 1}. ${steps[i]}\n`;
  }
  block += '\n';

  if (record.method || record.endpoint) {
    block += '**Request:**\n';
    block += `- Method: ${record.method || 'N/A'}\n`;
    block += `- Endpoint: ${record.endpoint || 'N/A'}\n`;
    block += '- Headers: Content-Type: application/json\n';
    if (redactedReqBody !== undefined && redactedReqBody !== null) {
      block += `- Body: \`${safeJsonExcerpt(redactedReqBody, 300)}\`\n`;
    } else {
      block += '- Body: N/A\n';
    }
    block += '\n';
  }

  if (record.responseStatus !== undefined) {
    block += '**Response:**\n';
    block += `- Status: ${record.responseStatus}\n`;
    const redactedRespBody = redactPasswords(record.responseBody);
    block += `- Body (excerpt): \`${safeJsonExcerpt(redactedRespBody, 400)}\`\n`;
    block += '\n';
  }

  block += `**Result:** ${statusBadge(status)}`;
  if (record.notes) {
    block += ` — ${record.notes.replace(/\n/g, ' ')}`;
  }
  block += '\n\n';

  block += `**Evidence File:** \`evidence/${category}/${record.testCaseId}.json\`\n\n`;
  block += hr();

  return block;
}

interface CategoryStats {
  category: EvidenceCategory;
  label: string;
  total: number;
  pass: number;
  fail: number;
}

export function generate(outputDir: string, _workspaceRoot: string): void {
  const allStats: CategoryStats[] = [];
  const categoryRecords = new Map<EvidenceCategory, EvidenceRecord[]>();

  for (const cat of ALL_CATEGORIES) {
    const records = loadCategoryResults(outputDir, cat);
    categoryRecords.set(cat, records);
    const pass = records.filter(r => r.passed).length;
    allStats.push({
      category: cat,
      label: CATEGORY_LABELS[cat],
      total: records.length,
      pass,
      fail: records.length - pass,
    });
  }

  const tocEntries = [
    { level: 1, title: 'Introduction' },
    { level: 1, title: 'Scope and Methodology' },
    { level: 1, title: 'Evidence Summary' },
  ];

  for (const cat of ALL_CATEGORIES) {
    const records = categoryRecords.get(cat);
    if (records && records.length > 0) {
      tocEntries.push({ level: 1, title: `${CATEGORY_LABELS[cat]} — Execution Records` });
    }
  }

  tocEntries.push(
    { level: 1, title: 'Execution Summary' },
    { level: 1, title: 'Anomalies and Observations' },
    { level: 1, title: 'Conclusion' },
    { level: 1, title: 'Approval Signatures' },
  );

  let content = '';

  content += documentHeader({
    title: 'Detailed Test Execution Records',
    documentId: `TER-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential — Regulatory',
  });

  content += tableOfContents(tocEntries) + '\n';
  content += hr();

  // --- Section 1: Introduction ---
  content += section(2, 'Introduction');
  content += `This document provides detailed test execution records for the **${SYSTEM_INFO.fullName}** `;
  content += `(v${SYSTEM_INFO.version}) validation. Each record captures the complete test execution `;
  content += 'context including test procedure, request/response data, timing, and pass/fail determination.\n\n';
  content += 'These records constitute the primary evidence that validation test cases were executed ';
  content += 'as specified in the IQ, OQ, PQ, Security, Disaster Recovery, and Performance test protocols. ';
  content += 'They satisfy the 21 CFR Part 11 requirement for documented evidence of system validation ';
  content += '(§11.10(a)) and provide an immutable record for regulatory inspection.\n\n';
  content += hr();

  // --- Section 2: Scope and Methodology ---
  content += section(2, 'Scope and Methodology');
  content += section(3, 'Test Environment');
  content += `- **API Endpoint:** ${SYSTEM_INFO.environments.production.apiUrl}\n`;
  content += `- **Frontend URL:** ${SYSTEM_INFO.environments.production.frontendUrl}\n`;
  content += `- **Database:** ${SYSTEM_INFO.environments.production.databaseHost}\n`;
  content += `- **Test Execution Date:** ${DOC_DATE}\n`;
  content += `- **System Version:** ${SYSTEM_INFO.version}\n\n`;

  content += section(3, 'Test Execution Approach');
  content += 'All tests were executed against the production-equivalent environment using automated test scripts ';
  content += '(`tests-live/` framework). Each test case:\n\n';
  content += '1. Sends HTTP requests to the live API with controlled inputs\n';
  content += '2. Captures the full request/response cycle including headers, status codes, and body\n';
  content += '3. Evaluates acceptance criteria programmatically\n';
  content += '4. Records the result with timestamp, duration, and detailed notes\n';
  content += '5. Saves structured evidence as JSON for traceability\n\n';

  content += section(3, 'Data Handling');
  content += '- All password fields in request bodies are **redacted** in this report\n';
  content += '- Response bodies are shown as excerpts (truncated at 400 characters)\n';
  content += '- Full unredacted evidence is retained in the JSON evidence files\n';
  content += '- All timestamps are in **UTC** format\n\n';
  content += hr();

  // --- Section 3: Evidence Summary ---
  content += section(2, 'Evidence Summary');
  content += 'The following table summarizes evidence collected across all test categories:\n\n';

  const summaryRows: string[][] = [];
  let grandTotal = 0;
  let grandPass = 0;
  let grandFail = 0;

  for (const stat of allStats) {
    if (stat.total === 0) {
      summaryRows.push([stat.label, '0', 'N/A', 'N/A', 'No evidence collected']);
    } else {
      const rate = ((stat.pass / stat.total) * 100).toFixed(1) + '%';
      summaryRows.push([
        stat.label,
        String(stat.total),
        String(stat.pass),
        String(stat.fail),
        rate,
      ]);
    }
    grandTotal += stat.total;
    grandPass += stat.pass;
    grandFail += stat.fail;
  }

  const grandRate = grandTotal > 0 ? ((grandPass / grandTotal) * 100).toFixed(1) + '%' : 'N/A';
  summaryRows.push(['**TOTAL**', `**${grandTotal}**`, `**${grandPass}**`, `**${grandFail}**`, `**${grandRate}**`]);

  content += markdownTable(
    ['Category', 'Total Tests', 'Passed', 'Failed', 'Pass Rate'],
    summaryRows,
  );
  content += '\n';
  content += hr();

  // --- Per-category execution records ---
  for (const cat of ALL_CATEGORIES) {
    const records = categoryRecords.get(cat);
    if (!records || records.length === 0) continue;

    content += section(2, `${CATEGORY_LABELS[cat]} — Execution Records`);

    const catPass = records.filter(r => r.passed).length;
    const catFail = records.length - catPass;
    content += `**Category Summary:** ${records.length} test cases executed — `;
    content += `${catPass} passed, ${catFail} failed\n\n`;

    const sortedRecords = [...records].sort((a, b) => {
      const aNum = parseInt(a.testCaseId.replace(/\D+/g, ''), 10) || 0;
      const bNum = parseInt(b.testCaseId.replace(/\D+/g, ''), 10) || 0;
      return aNum - bNum;
    });

    content += section(3, `${cat.toUpperCase()} Test Index`);
    const indexRows = sortedRecords.map(r => [
      r.testCaseId,
      (r.testDescription || 'N/A').substring(0, 80).replace(/\|/g, '\\|'),
      r.passed ? '✅ Pass' : '❌ Fail',
      formatDuration(r.durationMs),
    ]);
    content += markdownTable(
      ['Test ID', 'Description', 'Result', 'Duration'],
      indexRows,
    );
    content += '\n';
    content += hr();

    for (const record of sortedRecords) {
      content += renderExecutionRecord(record, cat);
    }
  }

  // --- Execution Summary ---
  content += section(2, 'Execution Summary');

  content += section(3, 'Overall Results');
  content += `- **Total Test Cases Executed:** ${grandTotal}\n`;
  content += `- **Total Passed:** ${grandPass}\n`;
  content += `- **Total Failed:** ${grandFail}\n`;
  content += `- **Overall Pass Rate:** ${grandRate}\n`;
  content += `- **Execution Date:** ${DOC_DATE}\n\n`;

  content += section(3, 'Results by Category');
  content += markdownTable(
    ['Category', 'Tests', 'Pass', 'Fail', 'Rate', 'Status'],
    allStats.map(s => {
      if (s.total === 0) return [s.label, '0', '—', '—', 'N/A', 'Not Executed'];
      const rate = ((s.pass / s.total) * 100).toFixed(1) + '%';
      const status = s.fail === 0 ? '✅ Complete' : '⚠️ Deviations';
      return [s.label, String(s.total), String(s.pass), String(s.fail), rate, status];
    }),
  );
  content += '\n';

  content += section(3, 'Failed Test Cases');
  const failedRecords: Array<{ category: EvidenceCategory; record: EvidenceRecord }> = [];
  for (const cat of ALL_CATEGORIES) {
    const records = categoryRecords.get(cat);
    if (!records) continue;
    for (const r of records) {
      if (!r.passed) {
        failedRecords.push({ category: cat, record: r });
      }
    }
  }

  if (failedRecords.length === 0) {
    content += 'No test failures were recorded. All executed test cases met their acceptance criteria.\n\n';
  } else {
    content += `${failedRecords.length} test case(s) did not meet acceptance criteria:\n\n`;
    content += markdownTable(
      ['Test ID', 'Category', 'Description', 'Notes'],
      failedRecords.map(({ category, record }) => [
        record.testCaseId,
        category.toUpperCase(),
        (record.testDescription || 'N/A').substring(0, 60).replace(/\|/g, '\\|'),
        (record.notes || 'N/A').substring(0, 80).replace(/\|/g, '\\|'),
      ]),
    );
    content += '\n';
    content += '> **Note:** Each failed test case must be documented in the Deviation Log (10-deviation-log.md) ';
    content += 'and assessed for impact per the CAPA process (11-capa-records.md).\n\n';
  }
  content += hr();

  // --- Anomalies and Observations ---
  content += section(2, 'Anomalies and Observations');
  content += 'The following anomalies and observations were noted during test execution:\n\n';
  content += '| # | Observation | Severity | Test Cases Affected | Disposition |\n';
  content += '|---|------------|----------|--------------------|-----------|\n';
  content += '| 1 | [To be documented by QA reviewer] | — | — | — |\n\n';
  content += '> **Instructions:** QA personnel should review all execution records above and note any ';
  content += 'patterns, timing anomalies, unexpected behaviors (even in passing tests), or environmental ';
  content += 'factors that may affect result interpretation.\n\n';
  content += hr();

  // --- Conclusion ---
  content += section(2, 'Conclusion');
  if (grandTotal === 0) {
    content += 'No test evidence has been collected. Test execution is pending.\n\n';
  } else if (grandFail === 0) {
    content += `All **${grandTotal}** test cases across ${allStats.filter(s => s.total > 0).length} `;
    content += 'categories were executed successfully. All acceptance criteria were met. ';
    content += 'The test execution records provide documented evidence supporting the validation conclusion ';
    content += `that the ${SYSTEM_INFO.fullName} operates as intended per its specifications.\n\n`;
  } else {
    content += `Of **${grandTotal}** test cases executed, **${grandFail}** did not meet acceptance criteria. `;
    content += 'These failures have been documented and must be evaluated through the deviation and CAPA process ';
    content += 'before a final validation conclusion can be made.\n\n';
  }

  content += 'This document, together with the referenced JSON evidence files, constitutes the complete ';
  content += 'test execution record for the validation as required by:\n\n';
  content += '- **21 CFR Part 11 §11.10(a):** Documented evidence of system validation\n';
  content += '- **ICH E6(R2) §5.5.3:** Documentation of computerized system validation\n';
  content += '- **GAMP 5:** Test execution evidence within the V-model lifecycle\n\n';
  content += hr();

  // --- Approval Signatures ---
  content += approvalBlock([
    'QA Lead — Test Execution Reviewer',
    'Validation Lead',
    'System Owner',
    'Quality Assurance Director',
  ]);

  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '20-test-execution-records.md'), content);
}
