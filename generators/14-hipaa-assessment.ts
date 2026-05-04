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
    { level: 1, title: 'Purpose and Scope' },
    { level: 1, title: 'ePHI Inventory' },
    { level: 1, title: 'Threat Analysis' },
    { level: 1, title: 'Vulnerability Analysis' },
    { level: 1, title: 'Technical Safeguards Assessment' },
    { level: 1, title: 'Administrative Safeguards Summary' },
    { level: 1, title: 'Physical Safeguards Summary' },
    { level: 1, title: 'Business Associate Agreement Requirements' },
    { level: 1, title: 'Breach Notification Procedures' },
    { level: 1, title: 'Risk Management Plan' },
    { level: 1, title: 'Incident Response Procedures' },
    { level: 1, title: 'Approval Signatures' },
  ]);

  let content = '';

  content += documentHeader({
    title: 'HIPAA Security Risk Analysis',
    documentId: `HIPAA-RA-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential — Regulatory — HIPAA',
  });

  content += toc + '\n';
  content += hr();

  // Section 1: Purpose and Scope
  content += section(2, 'Purpose and Scope');
  content += `This HIPAA Security Risk Analysis documents the assessment of risks to the confidentiality, `;
  content += `integrity, and availability of electronic Protected Health Information (ePHI) processed by the `;
  content += `**${SYSTEM_INFO.fullName}** (v${SYSTEM_INFO.version}).\n\n`;
  content += 'This analysis is performed in accordance with:\n\n';
  content += '- **45 CFR 164.308(a)(1)(ii)(A)** — Risk Analysis (Required)\n';
  content += '- **45 CFR 164.308(a)(1)(ii)(B)** — Risk Management (Required)\n';
  content += '- **NIST SP 800-30** — Guide for Conducting Risk Assessments\n';
  content += '- **HHS Guidance** on Risk Analysis Requirements under the HIPAA Security Rule\n\n';

  content += section(3, 'Scope');
  content += 'This risk analysis covers:\n\n';
  content += `- All ePHI created, received, maintained, or transmitted by the ${SYSTEM_INFO.name}\n`;
  content += '- All system components that store, process, or transmit ePHI\n';
  content += '- All users who access ePHI through the system\n';
  content += '- All environments where the system operates (production, staging, development)\n\n';
  content += hr();

  // Section 2: ePHI Inventory
  content += section(2, 'ePHI Inventory');
  content += 'The following ePHI data elements are stored, processed, or transmitted by the system:\n\n';

  const ephiRows: string[][] = REGULATORY_SCOPE.ephiFields.map((field, i) => {
    const locations = getEphiLocations(field);
    const accessRoles = getEphiAccessRoles(field);
    return [
      `ePHI-${String(i + 1).padStart(3, '0')}`,
      field,
      locations,
      accessRoles,
    ];
  });

  content += markdownTable(
    ['ID', 'ePHI Element', 'Storage Location(s)', 'Authorized Access'],
    ephiRows,
  );
  content += '\n';

  const ephiRecords = REGULATORY_SCOPE.regulatedRecords.filter((r) => r.dataClassification === 'ePHI');
  content += section(3, 'ePHI Record Types');
  content += 'The following regulated record types contain ePHI:\n\n';
  ephiRecords.forEach((r) => {
    content += `- **${r.id}: ${r.name}** — ${r.description} (Retention: ${r.retentionYears} years)\n`;
  });
  content += '\n';
  content += hr();

  // Section 3: Threat Analysis
  content += section(2, 'Threat Analysis');
  content += 'The following threats to ePHI have been identified and assessed:\n\n';

  content += markdownTable(
    ['Threat ID', 'Threat', 'Category', 'Likelihood', 'Impact', 'Risk Level', 'Mitigation Status'],
    [
      ['THR-001', 'Unauthorized access via stolen credentials', 'External / Deliberate', 'Medium', 'High', 'High', 'Mitigated — MFA, password policy, session timeout, account lockout'],
      ['THR-002', 'Data breach via SQL injection', 'External / Deliberate', 'Low', 'Critical', 'High', 'Mitigated — Parameterized queries enforced; no raw SQL concatenation'],
      ['THR-003', 'Ransomware attack on infrastructure', 'External / Deliberate', 'Medium', 'Critical', 'Critical', 'Partially mitigated — AES-256 encrypted backups, cloud hosting isolation'],
      ['THR-004', 'Insider threat — unauthorized data access', 'Internal / Deliberate', 'Low', 'High', 'Medium', 'Mitigated — RBAC, audit trails, least-privilege access'],
      ['THR-005', 'Insider threat — unauthorized data modification', 'Internal / Deliberate', 'Low', 'Critical', 'High', 'Mitigated — Audit trails, data locks, e-signature for critical changes'],
      ['THR-006', 'System failure — database corruption', 'Technical / Accidental', 'Low', 'Critical', 'High', 'Mitigated — Automated backups, transaction integrity, ACID compliance'],
      ['THR-007', 'Natural disaster — data center failure', 'Environmental', 'Low', 'Critical', 'Medium', 'Partially mitigated — Cloud hosting with regional redundancy, encrypted offsite backups'],
      ['THR-008', 'Social engineering — phishing attack', 'External / Deliberate', 'Medium', 'High', 'High', 'Partially mitigated — Security training, unique user IDs, session management'],
      ['THR-009', 'Data exposure via unencrypted transmission', 'Technical / Accidental', 'Low', 'High', 'Medium', 'Mitigated — TLS 1.2+ enforced for all API communications'],
      ['THR-010', 'Data loss due to failed backup', 'Technical / Accidental', 'Low', 'Critical', 'High', 'Mitigated — Backup verification, retention policy, encrypted cloud storage'],
      ['THR-011', 'Session hijacking', 'External / Deliberate', 'Low', 'High', 'Medium', 'Mitigated — JWT with expiration, device fingerprinting, single-session enforcement'],
      ['THR-012', 'Cross-site scripting (XSS)', 'External / Deliberate', 'Low', 'Medium', 'Medium', 'Mitigated — Angular built-in XSS protection, CSP headers'],
    ],
  );
  content += '\n';
  content += hr();

  // Section 4: Vulnerability Analysis
  content += section(2, 'Vulnerability Analysis');
  content += 'The following potential vulnerabilities have been identified and assessed:\n\n';

  content += markdownTable(
    ['Vuln ID', 'Vulnerability', 'Component', 'Severity', 'Status', 'Remediation'],
    [
      ['VUL-001', 'Dependency vulnerabilities in npm packages', 'Backend API, Frontend', 'Varies', 'Ongoing monitoring', 'Regular npm audit and dependency updates via CI pipeline'],
      ['VUL-002', 'Default database credentials in development', 'Development environment', 'High', 'Mitigated', 'Production uses unique credentials; dev credentials not used in staging/prod'],
      ['VUL-003', 'Verbose error messages in API responses', 'Backend API', 'Medium', 'Mitigated', 'Global error handler sanitizes error messages in production mode'],
      ['VUL-004', 'Potential CSRF on state-changing API endpoints', 'Backend API', 'Medium', 'Mitigated', 'JWT-based authentication (not cookie-based); CSRF not applicable for token auth'],
      ['VUL-005', 'Audit trail storage in same database as application data', 'Database', 'Medium', 'Accepted risk', 'Database access requires separate admin credentials; audit tables have restricted write access'],
      ['VUL-006', 'Single point of failure — single database instance', 'Infrastructure', 'High', 'Accepted risk with mitigation', 'Automated backups with tested restore procedure; cloud provider SLA for availability'],
    ],
  );
  content += '\n';
  content += hr();

  // Section 5: Technical Safeguards Assessment
  content += section(2, 'Technical Safeguards Assessment');
  content += 'Assessment of system compliance with HIPAA Security Rule Technical Safeguards (45 CFR 164.312):\n\n';

  content += markdownTable(
    ['HIPAA Section', 'Requirement', 'Standard', 'Implementation', 'Status'],
    [
      ['164.312(a)(1)', 'Access control', 'Required', 'Role-Based Access Control (RBAC) implemented via auth.middleware.ts and authorization.middleware.ts. Users are assigned roles with specific permissions. All endpoints enforce authentication and authorization.', 'Implemented'],
      ['164.312(a)(2)(i)', 'Unique user identification', 'Required', 'Every user has a unique account with unique user ID. No shared accounts permitted. User provisioning via user management module.', 'Implemented'],
      ['164.312(a)(2)(ii)', 'Emergency access procedure', 'Required', 'Documented disaster recovery procedure allows authorized administrator emergency access. Procedure requires post-access audit review.', 'Documented — SOP required'],
      ['164.312(a)(2)(iii)', 'Automatic logoff', 'Addressable', 'Configurable session timeout implemented via idle timeout service. Default: 30 minutes of inactivity triggers automatic logoff. Device fingerprinting prevents session sharing.', 'Implemented'],
      ['164.312(a)(2)(iv)', 'Encryption and decryption', 'Addressable', 'AES-256 encryption for all backup data via backup.service.ts and encryption.service.ts. Key rotation supported. Database at rest encryption via cloud provider.', 'Implemented'],
      ['164.312(b)', 'Audit controls', 'Required', 'Comprehensive audit trail via audit.middleware.ts and audit.service.ts. Records who, what, when, old value, new value, reason for every data change. Immutable audit log.', 'Implemented'],
      ['164.312(c)(1)', 'Integrity', 'Required', 'Data validation rules at point of entry. Audit trails preserve complete data history. Data lock/freeze prevents unauthorized modification. Checksums for export integrity.', 'Implemented'],
      ['164.312(c)(2)', 'Mechanism to authenticate ePHI', 'Addressable', 'JWT-based authentication for all API access. Password re-authentication for e-signatures. Cryptographic hash linking signatures to records.', 'Implemented'],
      ['164.312(d)', 'Person or entity authentication', 'Required', 'Two-component authentication: unique user ID + password. Session management with device fingerprinting. Single active session enforcement.', 'Implemented'],
      ['164.312(e)(1)', 'Transmission security', 'Required', 'TLS 1.2+ enforced for all API communications. HTTPS required in production environment. No plaintext transmission of ePHI.', 'Implemented'],
      ['164.312(e)(2)', 'Encryption', 'Addressable', 'HTTPS encryption for all data in transit. AES-256 encryption for data at rest (backups). SSL/TLS certificates managed and renewed.', 'Implemented'],
    ],
  );
  content += '\n';
  content += hr();

  // Section 6: Administrative Safeguards Summary
  content += section(2, 'Administrative Safeguards Summary');
  content += 'The following administrative safeguards (45 CFR 164.308) are addressed:\n\n';

  content += markdownTable(
    ['HIPAA Section', 'Safeguard', 'Status', 'Evidence'],
    [
      ['164.308(a)(1)', 'Security Management Process', 'In Progress', 'This risk analysis; risk management plan below'],
      ['164.308(a)(2)', 'Assigned Security Responsibility', 'Pending', 'Security officer role to be formally assigned'],
      ['164.308(a)(3)', 'Workforce Security', 'Implemented', 'RBAC, user provisioning/deactivation, access reviews'],
      ['164.308(a)(4)', 'Information Access Management', 'Implemented', 'Role-based access, least-privilege, authorization middleware'],
      ['164.308(a)(5)', 'Security Awareness and Training', 'Pending', 'Training matrix defined (15-training-matrix.md); execution pending'],
      ['164.308(a)(6)', 'Security Incident Procedures', 'Partial', 'Incident response procedures defined below; formal SOP pending'],
      ['164.308(a)(7)', 'Contingency Plan', 'Partial', 'Backup/restore implemented; formal disaster recovery plan pending'],
      ['164.308(a)(8)', 'Evaluation', 'In Progress', 'This risk analysis constitutes the initial evaluation'],
      ['164.308(b)(1)', 'Business Associate Contracts', 'Pending', 'BAA requirements documented below; execution pending'],
    ],
  );
  content += '\n';
  content += hr();

  // Section 7: Physical Safeguards Summary
  content += section(2, 'Physical Safeguards Summary');
  content += 'Physical safeguards (45 CFR 164.310) are primarily the responsibility of the cloud infrastructure provider.\n\n';

  content += markdownTable(
    ['HIPAA Section', 'Safeguard', 'Responsibility', 'Status'],
    [
      ['164.310(a)(1)', 'Facility Access Controls', 'Cloud Provider (AWS)', 'Covered by AWS SOC 2 / HIPAA compliance'],
      ['164.310(a)(2)(i)', 'Contingency Operations', 'Shared', 'AWS regional redundancy + application-level backup/restore'],
      ['164.310(a)(2)(ii)', 'Facility Security Plan', 'Cloud Provider (AWS)', 'Covered by AWS physical security controls'],
      ['164.310(a)(2)(iii)', 'Access Control and Validation', 'Cloud Provider (AWS)', 'AWS data center access controls'],
      ['164.310(a)(2)(iv)', 'Maintenance Records', 'Cloud Provider (AWS)', 'AWS maintains infrastructure records'],
      ['164.310(b)', 'Workstation Use', 'Organization', 'Workstation security policy required'],
      ['164.310(c)', 'Workstation Security', 'Organization', 'Endpoint security policy required'],
      ['164.310(d)(1)', 'Device and Media Controls', 'Shared', 'Cloud storage managed by AWS; encrypted backups for portability'],
    ],
  );
  content += '\n';
  content += hr();

  // Section 8: Business Associate Agreement Requirements
  content += section(2, 'Business Associate Agreement Requirements');
  content += 'The following third-party service providers have access to or process ePHI and require ';
  content += 'Business Associate Agreements (BAAs):\n\n';

  content += markdownTable(
    ['Service Provider', 'Service', 'ePHI Access', 'BAA Status'],
    [
      ['Amazon Web Services (AWS)', 'Cloud hosting — Lightsail (backend, database)', 'Stores and processes ePHI', 'Required — AWS HIPAA BAA available'],
      ['Vercel', 'Frontend hosting and CDN', 'No direct ePHI access (SPA serves static assets; all data via API)', 'Evaluate — may not be required if no ePHI transits Vercel'],
      ['GitHub', 'Source code repository and CI/CD', 'No ePHI in source code (data is in database only)', 'Not required — no ePHI access'],
    ],
  );
  content += '\n';
  content += '> **Note:** BAA requirements should be reviewed by legal counsel. Any new third-party service that ';
  content += 'accesses, stores, or transmits ePHI requires a BAA before integration.\n\n';
  content += hr();

  // Section 9: Breach Notification Procedures
  content += section(2, 'Breach Notification Procedures');
  content += 'In accordance with 45 CFR 164 Subpart D (Breach Notification Rule), the following procedures apply:\n\n';

  content += section(3, 'Breach Identification');
  content += '1. Any suspected or confirmed unauthorized access, use, disclosure, or loss of ePHI must be reported immediately.\n';
  content += '2. The Security Officer (or designated alternate) must be notified within **24 hours** of discovery.\n';
  content += '3. An incident record must be created documenting the nature, scope, and circumstances of the breach.\n\n';

  content += section(3, 'Breach Assessment');
  content += 'Per 45 CFR 164.402, assess whether the incident constitutes a breach using the four-factor risk assessment:\n\n';
  content += '1. **Nature and extent** of ePHI involved (types and likelihood of identification)\n';
  content += '2. **Unauthorized person** who used or received the ePHI\n';
  content += '3. **Whether ePHI was actually acquired or viewed** (vs. mere opportunity)\n';
  content += '4. **Extent of mitigation** — what was done to reduce the risk of harm\n\n';

  content += section(3, 'Notification Requirements');
  content += 'If a breach is confirmed (not excluded by the risk assessment):\n\n';
  content += '- **Individual Notification:** Affected individuals must be notified within **60 days** of discovery (45 CFR 164.404)\n';
  content += '- **HHS Notification:** Report to HHS Secretary:\n';
  content += '  - Breaches affecting **500+ individuals**: Within **60 days** of discovery\n';
  content += '  - Breaches affecting **fewer than 500**: Annually, within **60 days** of calendar year end\n';
  content += '- **Media Notification:** If 500+ individuals in a single state/jurisdiction are affected, notify prominent media outlet within **60 days**\n\n';

  content += section(3, 'Documentation');
  content += 'All breach-related documentation must be retained for **6 years** per 45 CFR 164.530(j).\n\n';
  content += hr();

  // Section 10: Risk Management Plan
  content += section(2, 'Risk Management Plan');
  content += 'The following risk management activities will be performed on an ongoing basis:\n\n';

  content += '1. **Annual Risk Analysis:** This risk analysis will be reviewed and updated annually or upon significant system changes.\n';
  content += '2. **Vulnerability Scanning:** Regular vulnerability scanning of application dependencies and infrastructure.\n';
  content += '3. **Penetration Testing:** Annual penetration testing of the production environment (recommended).\n';
  content += '4. **Access Reviews:** Quarterly review of user access rights and role assignments.\n';
  content += '5. **Audit Trail Reviews:** Periodic review of audit trails per SOP schedule.\n';
  content += '6. **Backup Verification:** Monthly verification of backup integrity and restore capability.\n';
  content += '7. **Training:** Annual HIPAA security awareness training for all workforce members with ePHI access.\n';
  content += '8. **Incident Tracking:** All security incidents documented, investigated, and resolved per incident response procedures.\n';
  content += '9. **Policy Review:** Annual review of all security policies and procedures.\n';
  content += '10. **BAA Management:** Annual review of Business Associate Agreements for completeness.\n\n';
  content += hr();

  // Section 11: Incident Response Procedures
  content += section(2, 'Incident Response Procedures');
  content += 'The following incident response procedures apply to security incidents involving ePHI:\n\n';

  content += section(3, 'Phase 1: Detection and Reporting');
  content += '1. Security incidents may be detected via audit trail review, system monitoring, user reports, or external notification.\n';
  content += '2. Any workforce member who suspects a security incident must report it immediately to the Security Officer.\n';
  content += '3. Create an incident record with: date/time of detection, description, affected systems, affected ePHI, reporting person.\n\n';

  content += section(3, 'Phase 2: Containment');
  content += '1. Assess the scope and severity of the incident.\n';
  content += '2. Take immediate containment actions: disable compromised accounts, isolate affected systems, block suspicious IP addresses.\n';
  content += '3. Preserve evidence (logs, audit trails, system state) before making changes.\n\n';

  content += section(3, 'Phase 3: Investigation');
  content += '1. Determine the root cause of the incident.\n';
  content += '2. Identify all ePHI that was or may have been compromised.\n';
  content += '3. Identify all individuals whose ePHI was or may have been affected.\n';
  content += '4. Document findings in the incident record.\n\n';

  content += section(3, 'Phase 4: Remediation');
  content += '1. Implement corrective actions to prevent recurrence.\n';
  content += '2. Update system configurations, access controls, or procedures as needed.\n';
  content += '3. Initiate breach notification procedures if applicable (see Section 9).\n\n';

  content += section(3, 'Phase 5: Post-Incident Review');
  content += '1. Conduct post-incident review within 30 days.\n';
  content += '2. Update risk analysis if new threats or vulnerabilities were identified.\n';
  content += '3. Update incident response procedures based on lessons learned.\n';
  content += '4. Provide additional training if the incident resulted from workforce error.\n\n';
  content += hr();

  // Approval Signatures
  content += approvalBlock([
    'Security Officer / HIPAA Privacy Officer',
    'Quality Assurance Lead',
    'Project Manager',
    'System Owner',
  ]);

  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '14-hipaa-assessment.md'), content);
}

function getEphiLocations(field: string): string {
  const lower = field.toLowerCase();
  if (lower.includes('name') || lower.includes('contact')) {
    return 'PostgreSQL (acc_subjects, eCRF data), Encrypted backups';
  }
  if (lower.includes('date') || lower.includes('birth')) {
    return 'PostgreSQL (acc_subjects), Encrypted backups';
  }
  if (lower.includes('medical record')) {
    return 'PostgreSQL (acc_subjects), Encrypted backups';
  }
  if (lower.includes('diagnos') || lower.includes('history') || lower.includes('adverse') || lower.includes('medication') || lower.includes('examination')) {
    return 'PostgreSQL (eCRF form data), Encrypted backups, Data exports';
  }
  if (lower.includes('lab') || lower.includes('vital')) {
    return 'PostgreSQL (eCRF form data), Encrypted backups, Data exports';
  }
  if (lower.includes('treatment') || lower.includes('assignment')) {
    return 'PostgreSQL (acc_randomization), Encrypted backups';
  }
  return 'PostgreSQL (application database), Encrypted backups';
}

function getEphiAccessRoles(field: string): string {
  const lower = field.toLowerCase();
  if (lower.includes('treatment') || lower.includes('assignment') || lower.includes('unblinded')) {
    return 'Unblinded personnel only (per study protocol)';
  }
  if (lower.includes('contact')) {
    return 'Site staff, authorized monitors';
  }
  return 'Investigators, Site staff, Monitors/CRAs, Data Managers (per RBAC)';
}
