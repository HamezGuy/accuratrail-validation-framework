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

const DOC_DATE = new Date().toISOString().split('T')[0];
const DOC_YEAR = new Date().getFullYear();

export function generate(outputDir: string, _workspaceRoot: string): void {
  const toc = tableOfContents([
    { level: 1, title: 'Purpose' },
    { level: 1, title: 'System Description' },
    { level: 1, title: 'Electronic Records Assessment' },
    { level: 1, title: 'Electronic Signatures Assessment' },
    { level: 1, title: 'PHI/ePHI Assessment' },
    { level: 1, title: 'Applicable Predicate Rules' },
    { level: 1, title: 'Conclusion' },
    { level: 1, title: 'Approval Signatures' },
  ]);

  let content = '';

  content += documentHeader({
    title: 'Part 11 / HIPAA Applicability Assessment',
    documentId: `APP-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential — Regulatory',
  });

  content += toc + '\n';
  content += hr();

  // Section 1: Purpose
  content += section(2, 'Purpose');
  content += 'The purpose of this document is to determine the applicability of the following regulations ' +
    `to the **${SYSTEM_INFO.fullName}** (v${SYSTEM_INFO.version}):\n\n`;
  content += '- **21 CFR Part 11** — Electronic Records; Electronic Signatures\n';
  content += '- **HIPAA Security Rule** (45 CFR 164 Subpart C) — Security Standards for ePHI\n';
  content += '- **HIPAA Privacy Rule** (45 CFR 164 Subpart E) — Standards for Privacy of Individually Identifiable Health Information\n';
  content += '- **HIPAA Breach Notification Rule** (45 CFR 164 Subpart D)\n\n';
  content += 'This assessment follows FDA guidance ("Scope and Application," September 2003) ' +
    'and evaluates the system\'s electronic records, electronic signatures, and protected health information ' +
    'to determine which regulatory requirements apply and to what extent.\n\n';
  content += hr();

  // Section 2: System Description
  content += section(2, 'System Description');
  content += `**System Name:** ${SYSTEM_INFO.name}  \n`;
  content += `**Full Name:** ${SYSTEM_INFO.fullName}  \n`;
  content += `**Vendor:** ${SYSTEM_INFO.vendor}  \n`;
  content += `**Version:** ${SYSTEM_INFO.version}  \n`;
  content += `**Build Date:** ${SYSTEM_INFO.buildDate}  \n\n`;
  content += `**Description:** ${SYSTEM_INFO.description}\n\n`;
  content += `**Intended Use:** ${SYSTEM_INFO.intendedUse}\n\n`;

  content += section(3, 'System Architecture');
  content += markdownTable(
    ['Component', 'Technology', 'Version/Runtime'],
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

  content += section(3, 'Deployment Environments');
  content += markdownTable(
    ['Environment', 'API URL', 'Frontend URL', 'Database Host'],
    [
      ['Production', SYSTEM_INFO.environments.production.apiUrl, SYSTEM_INFO.environments.production.frontendUrl, SYSTEM_INFO.environments.production.databaseHost],
      ['Staging', SYSTEM_INFO.environments.staging.apiUrl, SYSTEM_INFO.environments.staging.frontendUrl, SYSTEM_INFO.environments.staging.databaseHost],
      ['Development', SYSTEM_INFO.environments.development.apiUrl, SYSTEM_INFO.environments.development.frontendUrl, SYSTEM_INFO.environments.development.databaseHost],
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

  // Section 3: Electronic Records Assessment
  content += section(2, 'Electronic Records Assessment');
  content += 'The system creates, modifies, maintains, archives, retrieves, and transmits the following ' +
    'electronic records. Each record is assessed for regulatory classification.\n\n';

  content += markdownTable(
    ['ID', 'Record Name', 'Description', 'Classification', 'Regulated', 'Retention (Years)'],
    REGULATORY_SCOPE.regulatedRecords.map((r) => [
      r.id,
      r.name,
      r.description,
      r.dataClassification.toUpperCase(),
      r.regulated ? 'Yes' : 'No',
      String(r.retentionYears),
    ]),
  );
  content += '\n';

  const ephiRecords = REGULATORY_SCOPE.regulatedRecords.filter((r) => r.dataClassification === 'ePHI');
  const clinicalRecords = REGULATORY_SCOPE.regulatedRecords.filter((r) => r.dataClassification === 'clinical');
  const systemRecords = REGULATORY_SCOPE.regulatedRecords.filter((r) => r.dataClassification === 'system');
  const adminRecords = REGULATORY_SCOPE.regulatedRecords.filter((r) => r.dataClassification === 'administrative');

  content += section(3, 'Record Summary by Classification');
  content += `- **ePHI Records:** ${ephiRecords.length} (${ephiRecords.map((r) => r.id).join(', ')})\n`;
  content += `- **Clinical Records:** ${clinicalRecords.length} (${clinicalRecords.map((r) => r.id).join(', ')})\n`;
  content += `- **System Records:** ${systemRecords.length} (${systemRecords.map((r) => r.id).join(', ')})\n`;
  content += `- **Administrative Records:** ${adminRecords.length} (${adminRecords.map((r) => r.id).join(', ')})\n\n`;

  content += `**Assessment:** All ${REGULATORY_SCOPE.regulatedRecords.length} record types are regulated electronic records ` +
    'within the meaning of 21 CFR Part 11. These records are required by FDA predicate rules and are maintained ' +
    'in electronic form as the official record.\n\n';
  content += hr();

  // Section 4: Electronic Signatures Assessment
  content += section(2, 'Electronic Signatures Assessment');
  content += `**Electronic Signatures Used:** ${REGULATORY_SCOPE.electronicSignaturesUsed ? 'Yes' : 'No'}\n\n`;
  content += 'The system implements electronic signatures to satisfy handwritten signature requirements ' +
    'in FDA predicate rules (21 CFR 312, 812). Signatures are applied to casebook locks, data freezes, ' +
    'query escalations, and data corrections.\n\n';

  content += section(3, 'Signature Method');
  content += `**Method:** ${REGULATORY_SCOPE.eSignatureDetails.method}\n\n`;

  content += section(3, 'Signature Components');
  content += 'Each electronic signature includes the following components as required by 21 CFR 11.50:\n\n';
  REGULATORY_SCOPE.eSignatureDetails.components.forEach((c) => {
    content += `- ${c}\n`;
  });
  content += '\n';

  content += section(3, 'Signature-to-Record Linkage');
  content += `**Linkage Mechanism:** ${REGULATORY_SCOPE.eSignatureDetails.linkage}\n\n`;
  content += 'This ensures that signatures cannot be excised, copied, or otherwise transferred to ' +
    'falsify an electronic record, as required by 21 CFR 11.70.\n\n';

  content += section(3, 'Non-Repudiation');
  content += `**Non-Repudiation Enforced:** ${REGULATORY_SCOPE.eSignatureDetails.nonRepudiation ? 'Yes' : 'No'}\n\n`;

  content += section(3, 'FDA Certification');
  content += `**FDA Certification Required:** ${REGULATORY_SCOPE.eSignatureDetails.fdaCertificationRequired ? 'Yes' : 'No'}\n\n`;
  content += 'Per 21 CFR 11.100(c), the organization must certify to FDA that its electronic signatures ' +
    'are intended to be the legally binding equivalent of handwritten signatures prior to or at the time ' +
    'of their use.\n\n';

  content += '**Assessment:** The system uses electronic signatures that are intended to be the legally ' +
    'binding equivalent of handwritten signatures. 21 CFR Part 11 Subpart C (Electronic Signatures) ' +
    'applies in full.\n\n';
  content += hr();

  // Section 5: PHI/ePHI Assessment
  content += section(2, 'PHI/ePHI Assessment');
  content += `**ePHI Present in System:** ${REGULATORY_SCOPE.ephiPresent ? 'Yes' : 'No'}\n\n`;
  content += 'The following individually identifiable health information is stored, processed, and/or ' +
    'transmitted electronically by the system, constituting electronic Protected Health Information (ePHI) ' +
    'under HIPAA (45 CFR 160.103):\n\n';

  REGULATORY_SCOPE.ephiFields.forEach((field, i) => {
    content += `${i + 1}. ${field}\n`;
  });
  content += '\n';

  content += section(3, 'HIPAA Applicability Justification');
  content += REGULATORY_SCOPE.hipaaJustification + '\n\n';

  content += '**Assessment:** The system stores, processes, and transmits ePHI as defined under HIPAA. ' +
    'The HIPAA Security Rule (45 CFR 164 Subpart C), Privacy Rule (45 CFR 164 Subpart E), and Breach ' +
    'Notification Rule (45 CFR 164 Subpart D) are applicable.\n\n';
  content += hr();

  // Section 6: Applicable Predicate Rules
  content += section(2, 'Applicable Predicate Rules');
  content += 'The following FDA predicate rules and regulatory standards are applicable to the records ' +
    'and signatures managed by this system:\n\n';

  content += markdownTable(
    ['Citation', 'Title', 'Applicability'],
    REGULATORY_SCOPE.predicateRules.map((r) => [r.citation, r.title, r.applicability]),
  );
  content += '\n';
  content += hr();

  // Section 7: Conclusion
  content += section(2, 'Conclusion');
  content += section(3, 'Formal Applicability Determination');
  content += 'Based on the assessment documented herein, the following regulatory requirements are ' +
    `determined to be applicable to the **${SYSTEM_INFO.fullName}**:\n\n`;

  content += '#### 21 CFR Part 11 — Electronic Records; Electronic Signatures\n\n';
  content += `**Applicable:** ${REGULATORY_SCOPE.part11Applicable ? '**YES — IN FULL**' : 'No'}\n\n`;
  content += `**Justification:** ${REGULATORY_SCOPE.part11Justification}\n\n`;
  content += '**Applicable Subparts:**\n\n';
  content += '- **Subpart B — Electronic Records** (11.10, 11.30, 11.50, 11.70): The system creates, ' +
    'modifies, maintains, archives, retrieves, and transmits electronic records required by FDA predicate rules.\n';
  content += '- **Subpart C — Electronic Signatures** (11.100, 11.200, 11.300): The system uses electronic ' +
    'signatures to satisfy handwritten signature requirements in predicate rules.\n\n';

  content += '**Applicable Sections:**\n\n';
  content += '| Section | Title | Applicable |\n';
  content += '|---------|-------|------------|\n';
  content += '| 11.10(a) | Validation | Yes |\n';
  content += '| 11.10(b) | Accurate and complete copies | Yes |\n';
  content += '| 11.10(c) | Record protection | Yes |\n';
  content += '| 11.10(d) | Limiting system access | Yes |\n';
  content += '| 11.10(e) | Audit trails | Yes |\n';
  content += '| 11.10(f) | Operational system checks | Yes |\n';
  content += '| 11.10(g) | Authority checks | Yes |\n';
  content += '| 11.10(h) | Device checks | Yes |\n';
  content += '| 11.10(i) | Training | Yes |\n';
  content += '| 11.10(j) | Documentation accountability | Yes |\n';
  content += '| 11.10(k)(1) | Documentation controls — distribution | Yes |\n';
  content += '| 11.10(k)(2) | Documentation controls — revision | Yes |\n';
  content += '| 11.30 | Open systems | N/A (closed system) |\n';
  content += '| 11.50 | Signature manifestations | Yes |\n';
  content += '| 11.70 | Signature/record linking | Yes |\n';
  content += '| 11.100 | General e-signature requirements | Yes |\n';
  content += '| 11.200 | E-signature components and controls | Yes |\n';
  content += '| 11.300 | Controls for ID codes/passwords | Yes |\n\n';

  content += '#### HIPAA — Health Insurance Portability and Accountability Act\n\n';
  content += `**Applicable:** ${REGULATORY_SCOPE.hipaaApplicable ? '**YES**' : 'No'}\n\n`;
  content += `**Justification:** ${REGULATORY_SCOPE.hipaaJustification}\n\n`;
  content += '**Applicable Subparts:**\n\n';
  content += '- **45 CFR 164 Subpart C** — Security Rule (Technical, Administrative, Physical Safeguards)\n';
  content += '- **45 CFR 164 Subpart D** — Breach Notification Rule\n';
  content += '- **45 CFR 164 Subpart E** — Privacy Rule\n\n';

  content += '**Key Security Rule Sections:**\n\n';
  content += '| Section | Title | Applicable |\n';
  content += '|---------|-------|------------|\n';
  content += '| 164.312(a)(1) | Access control | Yes |\n';
  content += '| 164.312(a)(2)(i) | Unique user identification | Yes |\n';
  content += '| 164.312(a)(2)(iii) | Automatic logoff | Yes |\n';
  content += '| 164.312(a)(2)(iv) | Encryption and decryption | Yes |\n';
  content += '| 164.312(b) | Audit controls | Yes |\n';
  content += '| 164.312(c)(1) | Integrity | Yes |\n';
  content += '| 164.312(d) | Person or entity authentication | Yes |\n';
  content += '| 164.312(e)(1) | Transmission security | Yes |\n\n';
  content += hr();

  // Approval signatures
  content += approvalBlock([
    'Quality Assurance Lead',
    'Regulatory Affairs Manager',
    'System Owner / Project Manager',
    'IT Security Officer',
  ]);

  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '01-applicability-assessment.md'), content);
}
