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
import { loadRunnerEvidence, RunnerResult } from './helpers/evidence-linker';

const DOC_DATE = new Date().toISOString().split('T')[0];
const DOC_YEAR = new Date().getFullYear();

interface EvidenceStats {
  total: number;
  pass: number;
  fail: number;
}

function tryLoadEvidence(outputDir: string, category: string): EvidenceStats {
  const resultPath = path.join(outputDir, 'evidence', category, `${category}-results.json`);
  try {
    if (fs.existsSync(resultPath)) {
      const data: unknown = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
      const results = Array.isArray(data) ? data : [];
      return {
        total: results.length,
        pass: results.filter((r: Record<string, unknown>) => r.passed === true).length,
        fail: results.filter((r: Record<string, unknown>) => r.passed === false).length,
      };
    }
  } catch { /* ignore */ }

  const evidencePath = path.join(outputDir, 'evidence', category, `${category}-evidence.json`);
  try {
    if (fs.existsSync(evidencePath)) {
      const data: unknown = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
      const results = Array.isArray(data) ? data : [];
      return {
        total: results.length,
        pass: results.filter((r: Record<string, unknown>) => r.passed === true).length,
        fail: results.filter((r: Record<string, unknown>) => r.passed === false).length,
      };
    }
  } catch { /* ignore */ }
  return { total: 0, pass: 0, fail: 0 };
}

function evidenceStatus(stats: EvidenceStats): string {
  if (stats.total === 0) return 'Pending';
  if (stats.fail > 0) return 'FAIL';
  return 'PASS';
}

function docExists(outputDir: string, filename: string): boolean {
  return fs.existsSync(path.join(outputDir, filename));
}

interface GateItem {
  num: number;
  item: string;
  evidence: string;
  releaseBlocking: boolean;
  statusFn: (outputDir: string, evidenceMap: Map<string, RunnerResult>) => string;
}

function checkTestCaseIds(ids: string[], evidenceMap: Map<string, RunnerResult>): string {
  let anyTested = false;
  let anyFailed = false;
  let allPassed = true;

  for (const id of ids) {
    const evidence = evidenceMap.get(id);
    if (evidence) {
      anyTested = true;
      if (!evidence.passed) {
        anyFailed = true;
        allPassed = false;
      }
    } else {
      allPassed = false;
    }
  }

  if (!anyTested) return 'Pending';
  if (anyFailed) return 'FAIL';
  if (allPassed) return 'PASS';
  return 'Partial';
}

function buildGateItems(): GateItem[] {
  return [
    {
      num: 1,
      item: 'Regulatory scope documented',
      evidence: '01-applicability-assessment.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '01-applicability-assessment.md') ? 'Generated' : 'Pending',
    },
    {
      num: 2,
      item: 'Validation Plan approved',
      evidence: '02-validation-plan.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '02-validation-plan.md') ? 'Generated' : 'Pending',
    },
    {
      num: 3,
      item: 'User Requirements approved',
      evidence: '03-user-requirements-spec.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '03-user-requirements-spec.md') ? 'Generated' : 'Pending',
    },
    {
      num: 4,
      item: 'Functional Requirements approved',
      evidence: '04-functional-requirements-spec.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '04-functional-requirements-spec.md') ? 'Generated' : 'Pending',
    },
    {
      num: 5,
      item: 'Risk Assessment approved',
      evidence: '05-risk-assessment.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '05-risk-assessment.md') ? 'Generated' : 'Pending',
    },
    {
      num: 6,
      item: 'Traceability Matrix complete',
      evidence: '06-traceability-matrix.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '06-traceability-matrix.md') ? 'Generated' : 'Pending',
    },
    {
      num: 7,
      item: 'IQ passed',
      evidence: '07-iq-protocol.md + evidence/iq/',
      releaseBlocking: true,
      statusFn: (dir) => evidenceStatus(tryLoadEvidence(dir, 'iq')),
    },
    {
      num: 8,
      item: 'OQ passed',
      evidence: '08-oq-protocol.md + evidence/oq/',
      releaseBlocking: true,
      statusFn: (dir) => evidenceStatus(tryLoadEvidence(dir, 'oq')),
    },
    {
      num: 9,
      item: 'PQ/UAT passed',
      evidence: '09-pq-protocol.md + evidence/pq/',
      releaseBlocking: true,
      statusFn: (dir) => evidenceStatus(tryLoadEvidence(dir, 'pq')),
    },
    {
      num: 10,
      item: 'Critical/High deviations closed',
      evidence: '10-deviation-log.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '10-deviation-log.md') ? 'Pending — Requires manual review' : 'Pending',
    },
    {
      num: 11,
      item: 'CAPA records closed (if any)',
      evidence: '11-capa-records.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '11-capa-records.md') ? 'Pending — Requires manual review' : 'Pending',
    },
    {
      num: 12,
      item: 'Audit trails tested',
      evidence: 'OQ evidence — audit trail test cases',
      releaseBlocking: true,
      statusFn: (_dir, em) => checkTestCaseIds(
        ['OQ-023', 'OQ-024', 'OQ-025', 'OQ-026', 'OQ-027', 'OQ-028', 'OQ-029', 'OQ-030', 'OQ-031', 'OQ-032', 'OQ-042', 'OQ-044'], em,
      ),
    },
    {
      num: 13,
      item: 'Access controls tested',
      evidence: 'OQ evidence — RBAC and authentication test cases',
      releaseBlocking: true,
      statusFn: (_dir, em) => checkTestCaseIds(
        ['OQ-001', 'OQ-002', 'OQ-003', 'OQ-005', 'OQ-006', 'OQ-008', 'OQ-009', 'OQ-010', 'OQ-011', 'OQ-012', 'OQ-013', 'OQ-014', 'OQ-015', 'OQ-016', 'OQ-017', 'OQ-018', 'OQ-019', 'OQ-020', 'OQ-021', 'OQ-022'], em,
      ),
    },
    {
      num: 14,
      item: 'E-signatures tested',
      evidence: 'OQ evidence — e-signature test cases',
      releaseBlocking: true,
      statusFn: (_dir, em) => checkTestCaseIds(
        ['OQ-033', 'OQ-034', 'OQ-035', 'OQ-036', 'OQ-037', 'OQ-038', 'OQ-039', 'OQ-040', 'OQ-041', 'OQ-042'], em,
      ),
    },
    {
      num: 15,
      item: 'Record export tested',
      evidence: 'OQ evidence — export test cases',
      releaseBlocking: true,
      statusFn: (_dir, em) => checkTestCaseIds(
        ['OQ-045', 'OQ-047', 'OQ-048', 'OQ-049', 'PQ-020'], em,
      ),
    },
    {
      num: 16,
      item: 'Backup/restore tested',
      evidence: 'PQ evidence — backup/restore test cases',
      releaseBlocking: true,
      statusFn: (_dir, em) => checkTestCaseIds(
        ['PQ-021', 'PQ-022', 'IQ-026', 'IQ-027', 'IQ-028'], em,
      ),
    },
    {
      num: 17,
      item: 'HIPAA safeguards documented',
      evidence: '14-hipaa-assessment.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '14-hipaa-assessment.md') ? 'Generated' : 'Pending',
    },
    {
      num: 18,
      item: 'Required SOPs approved',
      evidence: '13-sop-gap-analysis.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '13-sop-gap-analysis.md') ? 'Generated — Gaps require review' : 'Pending',
    },
    {
      num: 19,
      item: 'Required training complete',
      evidence: '15-training-matrix.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '15-training-matrix.md') ? 'Generated — Completion pending' : 'Pending',
    },
    {
      num: 20,
      item: 'Validation Summary Report approved',
      evidence: '12-validation-summary.md',
      releaseBlocking: true,
      statusFn: (dir) => docExists(dir, '12-validation-summary.md') ? 'Generated — Approval pending' : 'Pending',
    },
    {
      num: 21,
      item: 'Production release under change control',
      evidence: 'SOP-005: Change Control Management',
      releaseBlocking: true,
      statusFn: () => 'Pending',
    },
    {
      num: 22,
      item: 'Part 11 compliance controls tested',
      evidence: 'OQ evidence — Part 11 compliance test cases (OQ-056 to OQ-075)',
      releaseBlocking: true,
      statusFn: (_dir, em) => checkTestCaseIds(
        ['OQ-056', 'OQ-057', 'OQ-058', 'OQ-059', 'OQ-060', 'OQ-061', 'OQ-062', 'OQ-063', 'OQ-064', 'OQ-065', 'OQ-066', 'OQ-067', 'OQ-068', 'OQ-069', 'OQ-070'], em,
      ),
    },
    {
      num: 23,
      item: 'Security testing passed',
      evidence: 'Security evidence — OWASP test cases (SEC-001 to SEC-010)',
      releaseBlocking: true,
      statusFn: (_dir, em) => checkTestCaseIds(
        ['SEC-001', 'SEC-002', 'SEC-003', 'SEC-004', 'SEC-005', 'SEC-006', 'SEC-007', 'SEC-008', 'SEC-009', 'SEC-010'], em,
      ),
    },
    {
      num: 24,
      item: 'Password controls verified (expiration, history, lockout)',
      evidence: 'OQ evidence — §11.300 test cases',
      releaseBlocking: true,
      statusFn: (_dir, em) => checkTestCaseIds(
        ['OQ-056', 'OQ-057', 'OQ-066'], em,
      ),
    },
  ];
}

export function generate(outputDir: string, _workspaceRoot: string): void {
  const gateItems = buildGateItems();
  const evidenceMap = loadRunnerEvidence(outputDir);

  const toc = tableOfContents([
    { level: 1, title: 'Purpose' },
    { level: 1, title: 'Release Gate Checklist' },
    { level: 1, title: 'Release Decision' },
    { level: 1, title: 'Approval Signatures' },
  ]);

  let content = '';

  content += documentHeader({
    title: 'Release Gate Checklist',
    documentId: `RGC-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: 'AccuraTrial Electronic Data Capture System',
    classification: 'Confidential — Regulatory',
  });

  content += toc + '\n';
  content += hr();

  // Section 1: Purpose
  content += section(2, 'Purpose');
  content += 'This Release Gate Checklist is the **final go/no-go decision document** for releasing the ';
  content += 'AccuraTrial EDC System to production use. Every item marked as "Release-Blocking" must achieve ';
  content += 'a status of PASS or have an approved risk acceptance before the system can be released.\n\n';
  content += 'This checklist is completed after all validation activities (IQ, OQ, PQ) are finished and all ';
  content += 'supporting documentation is reviewed and approved.\n\n';
  content += hr();

  // Section 2: Release Gate Checklist
  content += section(2, 'Release Gate Checklist');

  const rows: string[][] = gateItems.map((item) => {
    const status = item.statusFn(outputDir, evidenceMap);
    return [
      String(item.num),
      item.item,
      status,
      item.evidence,
      item.releaseBlocking ? '**Yes**' : 'No',
    ];
  });

  content += markdownTable(
    ['#', 'Gate Item', 'Status', 'Evidence / Reference', 'Release-Blocking?'],
    rows,
  );
  content += '\n';

  // Summary counts
  const passCount = rows.filter((r) => r[2] === 'PASS' || r[2] === 'Generated').length;
  const failCount = rows.filter((r) => r[2] === 'FAIL').length;
  const pendingCount = rows.filter((r) => r[2].startsWith('Pending')).length;

  content += section(3, 'Gate Status Summary');
  content += markdownTable(
    ['Status', 'Count'],
    [
      ['PASS / Generated', String(passCount)],
      ['FAIL', String(failCount)],
      ['Pending', String(pendingCount)],
      ['Total Gate Items', String(gateItems.length)],
    ],
  );
  content += '\n';

  if (failCount > 0) {
    content += '> **WARNING:** One or more gate items have FAILED. The system **cannot** be released until all ';
    content += 'release-blocking items are resolved or have approved risk acceptances.\n\n';
  }
  content += hr();

  // Section 3: Release Decision
  content += section(2, 'Release Decision');
  content += 'Based on the gate checklist above, the following release decision is made:\n\n';
  content += '- [ ] **GO** — All release-blocking gate items have passed or have approved risk acceptances. ';
  content += 'The system is approved for production release.\n\n';
  content += '- [ ] **NO-GO** — One or more release-blocking gate items have not been satisfied. ';
  content += 'The system must not be released until all blocking items are resolved.\n\n';
  content += '- [ ] **CONDITIONAL GO** — The system may be released with the following conditions and risk acceptances:\n\n';
  content += '  | Condition | Risk Acceptance Rationale | Approved By | Date |\n';
  content += '  |-----------|--------------------------|-------------|------|\n';
  content += '  | | | | |\n';
  content += '  | | | | |\n\n';

  content += '> **Instructions:** Check ONE box above. If "CONDITIONAL GO" is selected, document all conditions ';
  content += 'and obtain formal risk acceptance from the System Owner.\n\n';
  content += hr();

  // Approval Signatures
  content += approvalBlock([
    'Quality Assurance Lead',
    'Project Manager',
    'System Owner',
  ]);

  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '16-release-gate-checklist.md'), content);
}
