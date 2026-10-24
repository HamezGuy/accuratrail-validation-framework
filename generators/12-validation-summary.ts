import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_INFO } from '../config/system-info';
import { E6_R3_SECTION_STATUS, ICH_E6_R3, REGULATORY_SCOPE } from '../config/regulatory-scope';
import {
  documentHeader,
  markdownTable,
  section,
  approvalBlock,
  tableOfContents,
  hr,
} from './helpers/markdown-writer';
import {
  loadRunnerEvidence, mappedCaseState, runnerCaseCheck, tryLoadEvidence, type RunnerResult,
} from './helpers/evidence-linker';
import { loadEvidence, registryCounts, type RegistryCounts } from '../runners/evidence-capture';
import { complianceRow, E6_R3_MAPPINGS, HIPAA_MAPPINGS, PART11_MAPPINGS, TA3_USE_MAPPINGS } from './helpers/compliance-mapping';
import { DEVIATION_DETECTION_CONTRACT, TA3_PQ_CASES } from '../config/ta3-pq-cases';

const DOC_DATE = new Date().toISOString().split('T')[0];
const DOC_YEAR = new Date().getFullYear();
const TA3_PQ_SECTION = 'TA3 Deviation Detection PQ';

/** A TA3 PQ case's status from its retained record (spec P20 3.5): a manual case stays pending and a case the
 * import could not derive is not executed, never passed. */
function pqtStatus(testCaseId: string, evidenceMap: Map<string, RunnerResult>): string {
  const code = evidenceMap.get(testCaseId)?.outcomeCode;
  const coded = code ? ` (${code})` : '';
  switch (mappedCaseState(testCaseId, evidenceMap)) {
    case 'passed': return 'PASS';
    case 'failed': return `FAIL${coded}`;
    case 'manual-pending': return 'Manual verification pending';
    case 'not-executed': return `Not executed${coded}`;
    default: return 'Pending: no O-7 import in this package';
  }
}

/** A qualification's registry cases, with its bookkeeping rows (setup, sessions, cleanup) counted apart (IR-416). */
function formatEvidenceRow(label: string, stats: RegistryCounts): string[] {
  if (stats.cases + stats.bookkeeping === 0) {
    return [label, '[To be completed after test execution]', '', '', '', ''];
  }
  const passRate = stats.cases > 0 ? ((stats.passed / stats.cases) * 100).toFixed(1) + '%' : 'N/A';
  return [label, String(stats.cases), String(stats.passed), String(stats.failed), passRate,
    stats.bookkeeping ? `${stats.bookkeeping} (${stats.bookkeepingNotPassed} not passed)` : '0'];
}

export function generate(outputDir: string, _workspaceRoot: string): void {
  const iqStats = registryCounts(loadEvidence(outputDir, 'iq'));
  const oqStats = registryCounts(loadEvidence(outputDir, 'oq'));
  const pqStats = registryCounts(loadEvidence(outputDir, 'pq'));
  const benchmarkStats = tryLoadEvidence(outputDir, 'benchmark');
  const p13Stats = tryLoadEvidence(outputDir, 'p13');
  const evidenceMap = loadRunnerEvidence(outputDir);

  const toc = tableOfContents([
    { level: 1, title: 'Executive Summary' },
    { level: 1, title: 'Validation Objective and Scope' },
    { level: 1, title: 'System Description' },
    { level: 1, title: 'Validation Activities Performed' },
    { level: 1, title: 'Validation Results Summary' },
    { level: 1, title: 'Part 11 Compliance Verification' },
    { level: 1, title: 'HIPAA Compliance Verification' },
    { level: 1, title: `${ICH_E6_R3.citation} Verification` },
    { level: 1, title: 'TA3 Use Verification' },
    { level: 1, title: TA3_PQ_SECTION },
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
  content += '- Dependency verification (Node.js version, npm packages, the vendored shared-types archives and their receipts)\n';
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
  content += '- Role-based access control enforcement\n';
  content += '- TA3 platform operations (suites 13 to 18): deviation detection, protocol version applicability, signed assessment ' +
    'and independent closure, timed escalation, the metrics ledger records and the inspection copy, against the designated ' +
    'armed synthetic study a ta3-oq-plan/1 names\n\n';
  content += 'Reference: **08-oq-protocol.md**\n\n';

  content += section(3, 'Performance Qualification (PQ)');
  content += 'The Performance Qualification verified that the system performs as intended under conditions that ';
  content += 'approximate real-world use, including end-to-end clinical workflows. PQ test cases covered:\n\n';
  content += '- Complete study lifecycle workflow (create study → enroll subjects → enter data → query → lock → export)\n';
  content += '- Multi-user concurrent access scenarios\n';
  content += '- Data integrity under load\n';
  content += '- Backup and restore cycle with data verification\n';
  content += '- User acceptance testing with representative clinical workflows\n';
  content += '- TA3 deviation detection on public protocols (PQT-001 to PQT-006), derived only from an imported O-7 run without '
    + 're-scoring; PQT-006, the answer key\'s adjudication by a qualified person, is manual\n\n';
  content += 'Reference: **09-pq-protocol.md**\n\n';
  content += hr();

  // Section 5: Validation Results Summary
  content += section(2, 'Validation Results Summary');

  content += markdownTable(
    ['Qualification', 'Registry Cases', 'Passed', 'Failed', 'Pass Rate', 'Bookkeeping Rows'],
    [
      formatEvidenceRow('Installation Qualification (IQ)', iqStats),
      formatEvidenceRow('Operational Qualification (OQ)', oqStats),
      formatEvidenceRow('Performance Qualification (PQ)', pqStats),
    ],
  );
  content += '\n';

  const totalTests = iqStats.cases + oqStats.cases + pqStats.cases;
  const totalPass = iqStats.passed + oqStats.passed + pqStats.passed;
  const totalFail = iqStats.failed + oqStats.failed + pqStats.failed;
  const bookkeeping = iqStats.bookkeeping + oqStats.bookkeeping + pqStats.bookkeeping;
  const bookkeepingNotPassed = iqStats.bookkeepingNotPassed + oqStats.bookkeepingNotPassed + pqStats.bookkeepingNotPassed;

  if (totalTests > 0) {
    const overallRate = ((totalPass / totalTests) * 100).toFixed(1);
    content += `**Overall:** ${totalTests} registry cases executed, ${totalPass} passed, ${totalFail} failed (${overallRate}% pass rate)`
      + `${bookkeeping ? `; ${bookkeeping} bookkeeping rows (setup, sessions, cleanup) are counted apart, ${bookkeepingNotPassed} of them not passed` : ''}\n\n`;
  } else if (bookkeeping > 0) {
    content += `**Overall:** no registry case was recorded; ${bookkeeping} bookkeeping rows (setup, sessions, cleanup), ${bookkeepingNotPassed} of them not passed\n\n`;
  } else {
    content += '**Overall:** [To be completed after test execution]\n\n';
  }
  content += section(3, 'Supplemental Synthetic Benchmark Evidence');
  content += benchmarkStats.total === 0
    ? 'No reconstructed benchmark evidence is attached. Benchmark performance remains unmeasured in this package.\n\n'
    : `${benchmarkStats.pass} of ${benchmarkStats.total} benchmark evidence checks passed; ${benchmarkStats.fail} failed or remain unexecuted. See **evidence/benchmark/benchmark-execution-report.md** and **20-test-execution-records.md**.\n\n`;
  content += 'These checks preserve the benchmark evaluator and gate results. They do not establish independent clinical validation, SURPASS target attainment, IL extraction performance, or regulatory certification. Their pass rate is not a clinical accuracy measure.\n\n';
  content += section(3, 'Supplemental Native P13 Evidence');
  content += p13Stats.total === 0
    ? 'No scoped native P13 attachment is present; protocol evaluation remains unmeasured in this package.\n\n'
    : `${p13Stats.pass} of ${p13Stats.total} P13 attachment checks passed; ${p13Stats.fail} failed or remain unexecuted. See **evidence/p13/p13-execution-report.md** and **20-test-execution-records.md**. Native statuses, source references and available denominators are retained separately from clinical operations metrics.\n\n`;
  content += 'P13 attachment checks do not invoke a model or independently re-score the native record. Their pass rate is not clinical accuracy, independent validation, or SURPASS attainment. Parser denominator counts may not be exposed by the native contract.\n\n';
  content += hr();

  // Section 6: Part 11 Compliance Verification
  content += section(2, 'Part 11 Compliance Verification');
  content += 'The following table summarizes the verification status of each applicable 21 CFR Part 11 section. A status reflects only '
    + 'the retained runner cases mapped to the section, each cited for what it actually checks; PASS means every mapped case passed in '
    + 'this run and is not a compliance determination. A section that no executed case verifies stays Pending.\n\n';

  content += markdownTable(
    ['Section', 'Title', 'Status', 'Mapped cases and what they verify'],
    PART11_MAPPINGS.map((m) => complianceRow(m, evidenceMap)),
  );
  content += '\n';
  content += hr();

  // Section 7: HIPAA Compliance Verification
  content += section(2, 'HIPAA Compliance Verification');
  content += 'The following table summarizes the verification status of applicable HIPAA Security Rule technical safeguards, '
    + 'on the same basis as the Part 11 table.\n\n';

  content += markdownTable(
    ['Section', 'Title', 'Status', 'Mapped cases and what they verify'],
    HIPAA_MAPPINGS.map((m) => complianceRow(m, evidenceMap)),
  );
  content += '\n';
  content += hr();

  // ICH E6(R3) Verification
  content += section(2, `${ICH_E6_R3.citation} Verification`);
  content += `Each topic of the ${ICH_E6_R3.citation} mapping, on the same basis as the Part 11 table: the base-suite cases whose `
    + 'check verifies the topic, then the TA3 cases whose catalog entry cites it. A topic no executed case verifies stays Pending. '
    + `The section references themselves stay "${E6_R3_SECTION_STATUS}".\n\n`;
  content += markdownTable(
    [`${ICH_E6_R3.citation} Reference`, 'Topic', 'Status', 'Mapped cases and what they verify'],
    E6_R3_MAPPINGS.map((m) => complianceRow(m, evidenceMap)),
  );
  content += '\n';
  content += hr();

  // TA3 Use Verification
  content += section(2, 'TA3 Use Verification');
  content += 'Each TA3 use this validation qualifies (TA3 plan item VAL-1), with the OQ suite that verifies it against the designated '
    + 'armed synthetic study a ta3-oq-plan/1 names. A case that met a feature switched off or absent at the release fails with its '
    + 'outcome code; a case recorded not executed (a setup gap such as NO_TA3_PLAN, or a suite not selected) leaves the use Pending '
    + 'or Incomplete, never passed.\n\n';
  content += markdownTable(
    ['TA3 Plan Section', 'TA3 Use', 'Status', 'Mapped cases and what they verify'],
    TA3_USE_MAPPINGS.map((m) => complianceRow(m, evidenceMap)),
  );
  content += '\n';
  content += hr();

  // TA3 PQ cases tied to the O-7 run
  content += section(2, TA3_PQ_SECTION);
  content += 'PQT-001 to PQT-006 tie the PQ to the O-7 run (TA3 plan VAL-1, spec P20 3.5). Only an imported O-7 run (summary '
    + `contract \`${DEVIATION_DETECTION_CONTRACT}\`) records them, derived from the reconstructed run without re-scoring; a `
    + 'package without that import leaves them pending. The answer key stays a draft, unadjudicated self-review until a '
    + 'qualified person adjudicates it, so PQT-006 stays manual and the detection figures are synthetic engineering evidence, '
    + 'not clinical accuracy. The release PQT-005 records is compared with the OQ release in the platform validation summary '
    + '(22-platform-validation-summary.md).\n\n';
  content += markdownTable(
    ['Case', 'Title', 'Status', 'What the import checks'],
    TA3_PQ_CASES.map(entry => [entry.id, entry.title, pqtStatus(entry.id, evidenceMap), runnerCaseCheck(entry.id).check]),
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
    ['17a', 'Electronic Signature Certification to FDA', '17a-esignature-certification-letter.md', 'Pending'],
    ['17b', 'System Architecture and Data Flow Diagram', '17b-data-flow-diagram.md', 'Pending'],
    ['17c', 'Authorized User List and Access Privileges', '17c-authorized-user-list.md', 'Pending'],
    ['18', 'Regulatory Requirements Traceability Map', '18-regulatory-requirements-map.md', 'Pending'],
    ['19', 'CSA Feature Assurance Records', '19-csa-feature-assurance.md', 'Pending'],
    ['20', 'Detailed Test Execution Records', '20-test-execution-records.md', 'Pending'],
    ['21', 'Design Specification (DS)', '21-design-specification.md', 'Pending'],
    ['22', 'Platform Validation Summary', '22-platform-validation-summary.md', 'Pending'],
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
