import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_INFO } from '../config/system-info';
import { REGULATORY_SCOPE } from '../config/regulatory-scope';
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

interface ComplianceMapping {
  section: string;
  title: string;
  testCaseIds: string[];
  evidenceRef: string;
}

const PART11_MAPPINGS: ComplianceMapping[] = [
  { section: '11.10(a)', title: 'Validation', testCaseIds: ['OQ-043', 'OQ-044', 'OQ-049', 'PQ-007'], evidenceRef: 'This validation package' },
  { section: '11.10(b)', title: 'Accurate and complete copies', testCaseIds: ['OQ-045', 'OQ-047', 'OQ-048', 'PQ-020'], evidenceRef: 'OQ — export test cases' },
  { section: '11.10(c)', title: 'Record protection', testCaseIds: ['IQ-026', 'IQ-027', 'PQ-021'], evidenceRef: 'OQ — access control, backup tests' },
  { section: '11.10(d)', title: 'Limiting system access', testCaseIds: ['OQ-001', 'OQ-002', 'OQ-003', 'OQ-005', 'OQ-006', 'OQ-008', 'OQ-009', 'OQ-010'], evidenceRef: 'OQ — RBAC, authentication tests' },
  { section: '11.10(e)', title: 'Audit trails', testCaseIds: ['OQ-023', 'OQ-024', 'OQ-025', 'OQ-026', 'OQ-027', 'OQ-028', 'OQ-029', 'OQ-030', 'OQ-031', 'OQ-032', 'OQ-042', 'OQ-044'], evidenceRef: 'OQ — audit trail test cases' },
  { section: '11.10(f)', title: 'Operational system checks', testCaseIds: ['OQ-043', 'PQ-008'], evidenceRef: 'OQ — validation rules, edit checks' },
  { section: '11.10(g)', title: 'Authority checks', testCaseIds: ['OQ-011', 'OQ-012', 'OQ-013', 'OQ-014', 'OQ-015', 'OQ-016', 'OQ-017', 'OQ-018', 'OQ-019', 'OQ-020', 'OQ-021', 'OQ-022'], evidenceRef: 'OQ — role-based access tests' },
  { section: '11.10(h)', title: 'Device checks', testCaseIds: ['OQ-005', 'OQ-007'], evidenceRef: 'IQ — infrastructure verification' },
  { section: '11.10(i)', title: 'Training', testCaseIds: [], evidenceRef: '15-training-matrix.md' },
  { section: '11.10(j)', title: 'Documentation accountability', testCaseIds: ['OQ-029'], evidenceRef: 'OQ — e-signature non-repudiation' },
  { section: '11.10(k)(1)', title: 'Documentation controls — distribution', testCaseIds: ['OQ-045'], evidenceRef: 'SOP review' },
  { section: '11.10(k)(2)', title: 'Documentation controls — revision', testCaseIds: ['OQ-046'], evidenceRef: 'SOP review' },
  { section: '11.50', title: 'Signature manifestations', testCaseIds: ['OQ-034', 'OQ-038'], evidenceRef: 'OQ — e-signature display tests' },
  { section: '11.70', title: 'Signature/record linking', testCaseIds: ['OQ-037'], evidenceRef: 'OQ — signature linkage tests' },
  { section: '11.100', title: 'General e-signature requirements', testCaseIds: ['OQ-033'], evidenceRef: 'OQ — e-signature test cases' },
  { section: '11.200', title: 'E-signature components and controls', testCaseIds: ['OQ-033'], evidenceRef: 'OQ — re-authentication tests' },
  { section: '11.300', title: 'Controls for ID codes/passwords', testCaseIds: ['OQ-004'], evidenceRef: 'OQ — password policy tests' },
];

const HIPAA_MAPPINGS: ComplianceMapping[] = [
  { section: '164.312(a)(1)', title: 'Access control', testCaseIds: ['OQ-011', 'OQ-012', 'OQ-013', 'OQ-014', 'OQ-015', 'OQ-016', 'OQ-017', 'OQ-018', 'OQ-019', 'OQ-020', 'OQ-021', 'OQ-022'], evidenceRef: 'OQ — RBAC tests' },
  { section: '164.312(a)(2)(i)', title: 'Unique user identification', testCaseIds: ['OQ-002'], evidenceRef: 'OQ — unique account tests' },
  { section: '164.312(a)(2)(ii)', title: 'Emergency access procedure', testCaseIds: [], evidenceRef: '14-hipaa-assessment.md' },
  { section: '164.312(a)(2)(iii)', title: 'Automatic logoff', testCaseIds: ['OQ-005'], evidenceRef: 'OQ — session timeout tests' },
  { section: '164.312(a)(2)(iv)', title: 'Encryption and decryption', testCaseIds: ['IQ-027'], evidenceRef: 'OQ — backup encryption tests' },
  { section: '164.312(b)', title: 'Audit controls', testCaseIds: ['OQ-023'], evidenceRef: 'OQ — audit trail tests' },
  { section: '164.312(c)(1)', title: 'Integrity', testCaseIds: ['OQ-043'], evidenceRef: 'OQ — data validation tests' },
  { section: '164.312(c)(2)', title: 'Mechanism to authenticate ePHI', testCaseIds: ['OQ-001'], evidenceRef: 'OQ — authentication tests' },
  { section: '164.312(d)', title: 'Person or entity authentication', testCaseIds: ['OQ-001'], evidenceRef: 'OQ — login/password tests' },
  { section: '164.312(e)(1)', title: 'Transmission security', testCaseIds: ['IQ-019'], evidenceRef: 'IQ — TLS verification' },
  { section: '164.312(e)(2)(i)', title: 'Integrity controls', testCaseIds: ['OQ-043'], evidenceRef: 'OQ — data integrity tests' },
  { section: '164.312(e)(2)(ii)', title: 'Encryption', testCaseIds: ['IQ-019'], evidenceRef: 'IQ — HTTPS enforcement tests' },
];

function deriveComplianceStatus(mapping: ComplianceMapping, evidenceMap: Map<string, RunnerResult>): string {
  if (mapping.testCaseIds.length === 0) return 'Pending';

  let anyTested = false;
  let anyFailed = false;
  let allPassed = true;

  for (const id of mapping.testCaseIds) {
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

function formatEvidenceRow(label: string, stats: EvidenceStats): string[] {
  if (stats.total === 0) {
    return [label, '[To be completed after test execution]', '', '', ''];
  }
  const passRate = stats.total > 0 ? ((stats.pass / stats.total) * 100).toFixed(1) + '%' : 'N/A';
  return [label, String(stats.total), String(stats.pass), String(stats.fail), passRate];
}

export function generate(outputDir: string, _workspaceRoot: string): void {
  const iqStats = tryLoadEvidence(outputDir, 'iq');
  const oqStats = tryLoadEvidence(outputDir, 'oq');
  const pqStats = tryLoadEvidence(outputDir, 'pq');
  const evidenceMap = loadRunnerEvidence(outputDir);

  const toc = tableOfContents([
    { level: 1, title: 'Executive Summary' },
    { level: 1, title: 'Validation Objective and Scope' },
    { level: 1, title: 'System Description' },
    { level: 1, title: 'Validation Activities Performed' },
    { level: 1, title: 'Validation Results Summary' },
    { level: 1, title: 'Part 11 Compliance Verification' },
    { level: 1, title: 'HIPAA Compliance Verification' },
    { level: 1, title: 'Deviations Summary' },
    { level: 1, title: 'CAPA Summary' },
    { level: 1, title: 'Traceability Verification' },
    { level: 1, title: 'Validation Documentation List' },
    { level: 1, title: 'Conclusion' },
    { level: 1, title: 'Recommendations' },
    { level: 1, title: 'Approval Signatures' },
  ]);

  let content = '';

  content += documentHeader({
    title: 'Validation Summary Report (VSR)',
    documentId: `VSR-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential — Regulatory',
  });

  content += toc + '\n';
  content += hr();

  // Section 1: Executive Summary
  content += section(2, 'Executive Summary');
  content += `This Validation Summary Report (VSR) documents the results of the computer system validation `;
  content += `performed on the **${SYSTEM_INFO.fullName}** (v${SYSTEM_INFO.version}). `;
  content += `The validation was conducted in accordance with the Validation Plan (VP-${DOC_YEAR}-001) `;
  content += `to demonstrate that the system meets its intended use requirements and complies with `;
  content += `applicable regulatory requirements including 21 CFR Part 11 and HIPAA.\n\n`;
  content += `This report summarizes all validation activities, test results, deviations, and corrective actions. `;
  content += `It provides the basis for the formal validation conclusion and release decision.\n\n`;
  content += hr();

  // Section 2: Validation Objective and Scope
  content += section(2, 'Validation Objective and Scope');

  content += section(3, 'Objective');
  content += `The objective of this validation is to provide documented evidence that the ${SYSTEM_INFO.fullName} `;
  content += `is fit for its intended use: ${SYSTEM_INFO.intendedUse}\n\n`;

  content += section(3, 'Scope');
  content += 'The validation scope encompasses:\n\n';
  content += '- **Installation Qualification (IQ):** Verifies that the system is installed correctly per specifications\n';
  content += '- **Operational Qualification (OQ):** Verifies that each function operates correctly per requirements\n';
  content += '- **Performance Qualification (PQ):** Verifies that the system performs as intended under real-world conditions\n';
  content += '- **21 CFR Part 11 Compliance:** Verifies electronic records and electronic signatures controls\n';
  content += '- **HIPAA Compliance:** Verifies technical safeguards for electronic Protected Health Information (ePHI)\n\n';

  content += section(3, 'Out of Scope');
  content += '- Legacy LibreClinica SOAP backend (read-only integration, not modified)\n';
  content += '- Third-party infrastructure provider qualification (AWS, Vercel — covered by vendor qualification)\n';
  content += '- Network infrastructure and physical security (cloud provider responsibility)\n\n';
  content += hr();

  // Section 3: System Description
  content += section(2, 'System Description');
  content += `**System Name:** ${SYSTEM_INFO.name}  \n`;
  content += `**Full Name:** ${SYSTEM_INFO.fullName}  \n`;
  content += `**Vendor:** ${SYSTEM_INFO.vendor}  \n`;
  content += `**Version:** ${SYSTEM_INFO.version}  \n`;
  content += `**Build Date:** ${SYSTEM_INFO.buildDate}  \n\n`;
  content += `**Description:** ${SYSTEM_INFO.description}\n\n`;
  content += `**Intended Use:** ${SYSTEM_INFO.intendedUse}\n\n`;

  content += section(3, 'Architecture');
  content += markdownTable(
    ['Component', 'Technology', 'Version'],
    [
      ['Frontend', SYSTEM_INFO.architecture.frontend.name, SYSTEM_INFO.architecture.frontend.version],
      ['Backend API', SYSTEM_INFO.architecture.backend.name, SYSTEM_INFO.architecture.backend.version],
      ['Database', SYSTEM_INFO.architecture.database.name, `${SYSTEM_INFO.architecture.database.version} (${SYSTEM_INFO.architecture.database.type})`],
      ['Shared Types', SYSTEM_INFO.architecture.sharedTypes.name, SYSTEM_INFO.architecture.sharedTypes.version],
      ['Interop Middleware', SYSTEM_INFO.architecture.interopMiddleware.name, SYSTEM_INFO.architecture.interopMiddleware.version],
      ['AI Pipeline', SYSTEM_INFO.architecture.aiPipeline.name, SYSTEM_INFO.architecture.aiPipeline.version],
    ],
  );
  content += '\n';

  content += section(3, 'Infrastructure');
  content += `- **Hosting:** ${SYSTEM_INFO.infrastructure.hosting}\n`;
  content += `- **Containerization:** ${SYSTEM_INFO.infrastructure.containerization}\n`;
  content += `- **CI/CD:** ${SYSTEM_INFO.infrastructure.ci}\n`;
  content += `- **Monitoring:** ${SYSTEM_INFO.infrastructure.monitoring}\n`;
  content += `- **Backups:** ${SYSTEM_INFO.infrastructure.backups}\n\n`;
  content += hr();

  // Section 4: Validation Activities Performed
  content += section(2, 'Validation Activities Performed');

  content += section(3, 'Installation Qualification (IQ)');
  content += 'The Installation Qualification verified that all system components are installed correctly and that the ';
  content += 'installation environment meets the specified requirements. IQ test cases covered:\n\n';
  content += '- Infrastructure verification (Docker containers, database connectivity, network configuration)\n';
  content += '- Dependency verification (Node.js version, npm packages, Python environment)\n';
  content += '- Database schema verification (all required tables, indexes, constraints exist)\n';
  content += '- Migration verification (all migrations applied successfully and idempotently)\n';
  content += '- API health check and endpoint availability\n';
  content += '- Frontend build and deployment verification\n';
  content += '- SSL/TLS certificate verification\n\n';
  content += 'Reference: **07-iq-protocol.md**\n\n';

  content += section(3, 'Operational Qualification (OQ)');
  content += 'The Operational Qualification verified that each system function operates correctly within specified ';
  content += 'parameters. OQ test cases covered:\n\n';
  content += '- Authentication and access control (login, logout, session management, RBAC)\n';
  content += '- Audit trail generation and integrity\n';
  content += '- Electronic signature creation, verification, and non-repudiation\n';
  content += '- Data entry, correction, and validation rules\n';
  content += '- Query creation, response, and resolution workflows\n';
  content += '- Data lock and freeze operations\n';
  content += '- Data export functionality (PDF, CSV, XML)\n';
  content += '- Backup and encryption verification\n';
  content += '- Role-based access control enforcement\n\n';
  content += 'Reference: **08-oq-protocol.md**\n\n';

  content += section(3, 'Performance Qualification (PQ)');
  content += 'The Performance Qualification verified that the system performs as intended under conditions that ';
  content += 'approximate real-world use, including end-to-end clinical workflows. PQ test cases covered:\n\n';
  content += '- Complete study lifecycle workflow (create study → enroll subjects → enter data → query → lock → export)\n';
  content += '- Multi-user concurrent access scenarios\n';
  content += '- Data integrity under load\n';
  content += '- Backup and restore cycle with data verification\n';
  content += '- User acceptance testing with representative clinical workflows\n\n';
  content += 'Reference: **09-pq-protocol.md**\n\n';
  content += hr();

  // Section 5: Validation Results Summary
  content += section(2, 'Validation Results Summary');

  content += markdownTable(
    ['Qualification', 'Total Tests', 'Passed', 'Failed', 'Pass Rate'],
    [
      formatEvidenceRow('Installation Qualification (IQ)', iqStats),
      formatEvidenceRow('Operational Qualification (OQ)', oqStats),
      formatEvidenceRow('Performance Qualification (PQ)', pqStats),
    ],
  );
  content += '\n';

  const totalTests = iqStats.total + oqStats.total + pqStats.total;
  const totalPass = iqStats.pass + oqStats.pass + pqStats.pass;
  const totalFail = iqStats.fail + oqStats.fail + pqStats.fail;

  if (totalTests > 0) {
    const overallRate = ((totalPass / totalTests) * 100).toFixed(1);
    content += `**Overall:** ${totalTests} tests executed, ${totalPass} passed, ${totalFail} failed (${overallRate}% pass rate)\n\n`;
  } else {
    content += '**Overall:** [To be completed after test execution]\n\n';
  }
  content += hr();

  // Section 6: Part 11 Compliance Verification
  content += section(2, 'Part 11 Compliance Verification');
  content += 'The following table summarizes the verification status of each applicable 21 CFR Part 11 section:\n\n';

  const part11Sections: string[][] = PART11_MAPPINGS.map((m) => [
    m.section, m.title, deriveComplianceStatus(m, evidenceMap), m.evidenceRef,
  ]);

  content += markdownTable(
    ['Section', 'Title', 'Status', 'Evidence Reference'],
    part11Sections,
  );
  content += '\n';
  content += hr();

  // Section 7: HIPAA Compliance Verification
  content += section(2, 'HIPAA Compliance Verification');
  content += 'The following table summarizes the verification status of applicable HIPAA Security Rule technical safeguards:\n\n';

  const hipaaSections: string[][] = HIPAA_MAPPINGS.map((m) => [
    m.section, m.title, deriveComplianceStatus(m, evidenceMap), m.evidenceRef,
  ]);

  content += markdownTable(
    ['Section', 'Title', 'Status', 'Evidence Reference'],
    hipaaSections,
  );
  content += '\n';
  content += hr();

  // Section 8: Deviations Summary
  content += section(2, 'Deviations Summary');
  content += 'All deviations identified during validation are recorded in the Deviation Log (**10-deviation-log.md**).\n\n';
  content += markdownTable(
    ['Severity', 'Count', 'Open', 'Closed', 'Risk-Accepted'],
    [
      ['Critical', '[TBD]', '[TBD]', '[TBD]', '[TBD]'],
      ['High', '[TBD]', '[TBD]', '[TBD]', '[TBD]'],
      ['Medium', '[TBD]', '[TBD]', '[TBD]', '[TBD]'],
      ['Low', '[TBD]', '[TBD]', '[TBD]', '[TBD]'],
    ],
  );
  content += '\n';
  content += '**Release-Blocking Deviations:** All Critical and High deviations must be closed or have an ';
  content += 'approved risk acceptance before the system can be validated for release.\n\n';
  content += 'Reference: **10-deviation-log.md**\n\n';
  content += hr();

  // Section 9: CAPA Summary
  content += section(2, 'CAPA Summary');
  content += 'All Corrective and Preventive Actions are recorded in the CAPA Records (**11-capa-records.md**).\n\n';
  content += markdownTable(
    ['Metric', 'Count'],
    [
      ['Total CAPAs Initiated', '[TBD]'],
      ['CAPAs Closed', '[TBD]'],
      ['CAPAs Open', '[TBD]'],
      ['CAPAs Pending Effectiveness Review', '[TBD]'],
    ],
  );
  content += '\n';
  content += 'Reference: **11-capa-records.md**\n\n';
  content += hr();

  // Section 10: Traceability Verification
  content += section(2, 'Traceability Verification');
  content += 'The Traceability Matrix (**06-traceability-matrix.md**) provides full forward and backward traceability ';
  content += 'from user requirements through functional requirements, risk assessments, and test cases.\n\n';
  content += 'Verification confirms that:\n\n';
  content += '- [ ] Every user requirement maps to at least one functional requirement\n';
  content += '- [ ] Every functional requirement maps to at least one test case\n';
  content += '- [ ] Every test case maps back to its source requirement\n';
  content += '- [ ] Every risk-rated feature has corresponding test coverage\n';
  content += '- [ ] No orphan test cases exist (all tests trace to a requirement)\n';
  content += '- [ ] No untested requirements exist (all requirements have test coverage)\n\n';
  content += 'Reference: **06-traceability-matrix.md**\n\n';
  content += hr();

  // Section 11: Validation Documentation List
  content += section(2, 'Validation Documentation List');
  content += 'The following documents comprise the complete validation package:\n\n';

  const documents: string[][] = [
    ['01', 'Applicability Assessment', '01-applicability-assessment.md', 'Pending'],
    ['02', 'Validation Plan', '02-validation-plan.md', 'Pending'],
    ['03', 'User Requirements Specification', '03-user-requirements-spec.md', 'Pending'],
    ['04', 'Functional Requirements Specification', '04-functional-requirements-spec.md', 'Pending'],
    ['05', 'Risk Assessment', '05-risk-assessment.md', 'Pending'],
    ['06', 'Traceability Matrix', '06-traceability-matrix.md', 'Pending'],
    ['07', 'IQ Protocol & Test Cases', '07-iq-protocol.md', 'Pending'],
    ['08', 'OQ Protocol & Test Cases', '08-oq-protocol.md', 'Pending'],
    ['09', 'PQ Protocol & Test Cases', '09-pq-protocol.md', 'Pending'],
    ['10', 'Deviation Log', '10-deviation-log.md', 'Pending'],
    ['11', 'CAPA Records', '11-capa-records.md', 'Pending'],
    ['12', 'Validation Summary Report', '12-validation-summary.md', 'This Document'],
    ['13', 'SOP Gap Analysis', '13-sop-gap-analysis.md', 'Pending'],
    ['14', 'HIPAA Security Risk Analysis', '14-hipaa-assessment.md', 'Pending'],
    ['15', 'Training Requirements Matrix', '15-training-matrix.md', 'Pending'],
    ['16', 'Release Gate Checklist', '16-release-gate-checklist.md', 'Pending'],
  ];

  for (const doc of documents) {
    const filePath = path.join(outputDir, doc[2]);
    if (fs.existsSync(filePath) && doc[3] === 'Pending') {
      doc[3] = 'Generated';
    }
  }

  content += markdownTable(
    ['#', 'Document', 'Filename', 'Status'],
    documents,
  );
  content += '\n';
  content += hr();

  // Section 12: Conclusion
  content += section(2, 'Conclusion');
  content += 'Based on the validation activities documented in this report and the supporting validation ';
  content += 'deliverables listed above, the following formal validation conclusion is made:\n\n';
  content += `### ${SYSTEM_INFO.fullName} (v${SYSTEM_INFO.version})\n\n`;
  content += '- [ ] **IS VALIDATED** for its intended use as described in the Validation Plan and User Requirements Specification. ';
  content += 'All acceptance criteria have been met, all release-blocking deviations have been closed or have approved risk acceptances, ';
  content += 'and the system complies with applicable 21 CFR Part 11 and HIPAA Security Rule requirements.\n\n';
  content += '- [ ] **IS NOT VALIDATED** due to unresolved release-blocking deviations, incomplete testing, or ';
  content += 'unacceptable compliance gaps. The system must not be released for production use until all blocking items are resolved.\n\n';
  content += '> **Instructions:** Check ONE box above based on the validation results. The checked conclusion must be consistent ';
  content += 'with the data in Sections 5–9 of this report.\n\n';
  content += hr();

  // Section 13: Recommendations
  content += section(2, 'Recommendations');
  content += 'The following recommendations are made based on the validation results:\n\n';
  content += '1. **Periodic revalidation** should be performed annually or upon significant system changes, per the change control SOP.\n';
  content += '2. **Ongoing monitoring** of audit trails and access logs should continue per operational SOPs.\n';
  content += '3. **Training** for all roles must be completed before production access is granted (see 15-training-matrix.md).\n';
  content += '4. **CAPA effectiveness reviews** should be scheduled per the timelines in 11-capa-records.md.\n';
  content += '5. **SOP gaps** identified in 13-sop-gap-analysis.md should be remediated per the priorities indicated.\n';
  content += '6. **HIPAA risk mitigations** documented in 14-hipaa-assessment.md should be implemented and verified.\n';
  content += '7. **Change control** must be enforced for all post-validation system modifications (SOP-005).\n\n';
  content += hr();

  // Approval Signatures
  content += approvalBlock([
    'Quality Assurance Lead',
    'Project Manager',
    'System Owner',
  ]);

  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '12-validation-summary.md'), content);
}
