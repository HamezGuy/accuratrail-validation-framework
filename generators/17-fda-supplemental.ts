/**
 * Generator 17: FDA-Specific Supplemental Documents
 * Produces the three supplemental documents that FDA inspectors specifically look for:
 * 1. Electronic Signature Certification Letter (21 CFR 11.100(c))
 * 2. System Data Flow Diagram
 * 3. Authorized User List Template
 */
import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_INFO } from '../config/system-info';
import { documentHeader, approvalBlock, hr, section } from './helpers/markdown-writer';

const DATE = new Date().toISOString().split('T')[0];
const YEAR = new Date().getFullYear();

function generateESignatureCertification(): string {
  let c = '';

  c += documentHeader({
    title: 'Electronic Signature Certification to FDA',
    documentId: `ESIG-CERT-${YEAR}-001`,
    version: '1.0',
    date: DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Regulatory — FDA Submission Required',
  });

  c += section(2, 'Purpose');
  c += 'This document provides the certification required by **21 CFR 11.100(c)** that electronic signatures ';
  c += 'used in the AccuraTrial EDC system are intended to be the legally binding equivalent of traditional ';
  c += 'handwritten signatures.\n\n';
  c += '> **IMPORTANT:** Per FDA guidance, this certification must be printed, signed with a traditional ';
  c += 'handwritten signature, and mailed to the FDA Office of Regional Operations **prior to or at the time** ';
  c += 'electronic signatures are first used.\n\n';
  c += hr();

  c += section(2, 'FDA Submission Address');
  c += '```\n';
  c += 'Office of Regional Operations (HFC-100)\n';
  c += '5600 Fishers Lane\n';
  c += 'Rockville, Maryland 20857\n';
  c += 'United States of America\n';
  c += '```\n\n';
  c += hr();

  c += section(2, 'Certification Letter');
  c += '> **Instructions:** Print this section on company letterhead, sign with handwritten signature, and mail to the address above.\n\n';
  c += '---\n\n';
  c += `**Date:** ${DATE}\n\n`;
  c += `**From:** ${SYSTEM_INFO.vendor}\n\n`;
  c += '**To:** Office of Regional Operations (HFC-100)\n';
  c += 'Food and Drug Administration\n';
  c += '5600 Fishers Lane\n';
  c += 'Rockville, Maryland 20857\n\n';
  c += '**Subject:** Certification of Electronic Signatures Pursuant to 21 CFR 11.100(c)\n\n';
  c += '---\n\n';
  c += 'Dear Sir or Madam,\n\n';
  c += `Pursuant to Section 11.100 of Title 21 of the Code of Federal Regulations, this is to certify that **${SYSTEM_INFO.vendor}** intends that all electronic signatures executed by our employees, agents, or representatives, located anywhere in the world, are the **legally binding equivalent of traditional handwritten signatures**.\n\n`;
  c += `This certification applies to electronic signatures used within the **${SYSTEM_INFO.fullName}** (version ${SYSTEM_INFO.version}), an Electronic Data Capture system used in FDA-regulated clinical trials.\n\n`;
  c += 'The electronic signature system employs the following controls to ensure the integrity and non-repudiation of each signature:\n\n';
  c += '1. Each electronic signature is **unique to one individual** and is not reused by, or reassigned to, anyone else.\n';
  c += '2. The identity of each individual is **verified** before the organization establishes, assigns, certifies, or otherwise sanctions the individual\'s electronic signature.\n';
  c += '3. Each signing event requires **two-component authentication**: verification of the signer\'s identity via username and re-entry of password.\n';
  c += '4. Each electronic signature includes the **printed name** of the signer, the **date and time** of signing (UTC), and the **meaning** (purpose) of the signature.\n';
  c += '5. Each electronic signature is **cryptographically linked** to the specific electronic record it signs, using SHA-256 hashing, such that the signature cannot be excised, copied, or transferred to falsify another record.\n\n';
  c += 'Sincerely,\n\n';
  c += '___________________________\n';
  c += '**[Authorized Signatory Name]**\n';
  c += '**[Title]**\n';
  c += `**${SYSTEM_INFO.vendor}**\n`;
  c += `**Date:** ____/____/________\n\n`;
  c += hr();

  c += section(2, 'Internal Record');
  c += '| Field | Value |\n';
  c += '|-------|-------|\n';
  c += '| Date Mailed to FDA | ____/____/________ |\n';
  c += '| Mailed By | _________________ |\n';
  c += '| Tracking Number | _________________ |\n';
  c += '| Confirmation Received | [ ] Yes  [ ] No  [ ] Pending |\n';
  c += '| Filed In | _________________ |\n\n';
  c += '---\n*End of Document*\n';

  return c;
}

function generateDataFlowDiagram(): string {
  let c = '';

  c += documentHeader({
    title: 'System Architecture and Data Flow Diagram',
    documentId: `DFD-${YEAR}-001`,
    version: '1.0',
    date: DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential — Regulatory',
  });

  c += section(2, 'Purpose');
  c += 'This document identifies the software and hardware components used in the AccuraTrial EDC system ';
  c += 'and describes the flow of clinical data through the system, as required by FDA guidance ';
  c += '"Computerized Systems Used in Clinical Trials" (April 1999), Section III, General Principle 2.\n\n';
  c += hr();

  c += section(2, 'System Components');
  c += '| Component | Technology | Version | Purpose |\n';
  c += '|-----------|-----------|---------|--------|\n';
  c += `| Frontend SPA | ${SYSTEM_INFO.architecture.frontend.name} | ${SYSTEM_INFO.architecture.frontend.version} | Clinical user interface — data entry, review, signatures |\n`;
  c += `| Backend API | ${SYSTEM_INFO.architecture.backend.name} | ${SYSTEM_INFO.architecture.backend.version} | Business logic, authentication, audit trails, data processing |\n`;
  c += `| Database | ${SYSTEM_INFO.architecture.database.name} | ${SYSTEM_INFO.architecture.database.version} | Persistent storage of all regulated electronic records |\n`;
  c += `| Shared Types | ${SYSTEM_INFO.architecture.sharedTypes.name} | ${SYSTEM_INFO.architecture.sharedTypes.version} | Canonical DTOs ensuring data contract consistency |\n`;
  c += `| Interop Middleware | ${SYSTEM_INFO.architecture.interopMiddleware.name} | ${SYSTEM_INFO.architecture.interopMiddleware.version} | EHR/FHIR integration bridge |\n`;
  c += `| AI Pipeline | ${SYSTEM_INFO.architecture.aiPipeline.name} | ${SYSTEM_INFO.architecture.aiPipeline.version} | Protocol parsing (human-reviewed, not auto-applied) |\n\n`;
  c += hr();

  c += section(2, 'Deployment Infrastructure');
  c += `| Environment | API Hosting | Frontend Hosting | Database Hosting |\n`;
  c += `|-------------|-----------|-----------------|------------------|\n`;
  c += `| Production | ${SYSTEM_INFO.environments.production.apiUrl} | ${SYSTEM_INFO.environments.production.frontendUrl} | ${SYSTEM_INFO.environments.production.databaseHost} |\n`;
  c += `| Staging | ${SYSTEM_INFO.environments.staging.apiUrl} | ${SYSTEM_INFO.environments.staging.frontendUrl} | ${SYSTEM_INFO.environments.staging.databaseHost} |\n`;
  c += `| Development | ${SYSTEM_INFO.environments.development.apiUrl} | ${SYSTEM_INFO.environments.development.frontendUrl} | ${SYSTEM_INFO.environments.development.databaseHost} |\n\n`;
  c += `**Containerization:** ${SYSTEM_INFO.infrastructure.containerization}\n`;
  c += `**CI/CD:** ${SYSTEM_INFO.infrastructure.ci}\n`;
  c += `**Backups:** ${SYSTEM_INFO.infrastructure.backups}\n\n`;
  c += hr();

  c += section(2, 'Data Flow — Clinical Trial Lifecycle');
  c += '```\n';
  c += '┌─────────────────────────────────────────────────────────────────┐\n';
  c += '│                    CLINICAL DATA FLOW                          │\n';
  c += '├─────────────────────────────────────────────────────────────────┤\n';
  c += '│                                                                 │\n';
  c += '│  [Browser/Device]                                               │\n';
  c += '│       │                                                         │\n';
  c += '│       ▼  HTTPS/TLS 1.2+                                        │\n';
  c += '│  ┌──────────────────┐                                           │\n';
  c += '│  │  Angular 19 SPA  │  Frontend (Vercel CDN)                    │\n';
  c += '│  │  - eCRF Entry    │                                           │\n';
  c += '│  │  - Review/Sign   │                                           │\n';
  c += '│  │  - Query Mgmt    │                                           │\n';
  c += '│  └────────┬─────────┘                                           │\n';
  c += '│           │  REST API calls (JSON over HTTPS)                   │\n';
  c += '│           ▼                                                     │\n';
  c += '│  ┌──────────────────────────────────────────┐                   │\n';
  c += '│  │         Express/Node.js REST API          │                  │\n';
  c += '│  │                                            │                 │\n';
  c += '│  │  Request Lifecycle:                        │                 │\n';
  c += '│  │  1. Rate Limiter (DDoS protection)         │                 │\n';
  c += '│  │  2. Auth Middleware (JWT verification)      │                 │\n';
  c += '│  │  3. Authorization (RBAC - 6 roles/42 perms)│                 │\n';
  c += '│  │  4. Validation (Joi schema)                 │                │\n';
  c += '│  │  5. Part 11 Middleware (e-sig verification)  │               │\n';
  c += '│  │  6. Controller (request/response mapping)    │               │\n';
  c += '│  │  7. Service (business logic)                 │               │\n';
  c += '│  │  8. Audit Middleware (auto-log all mutations) │              │\n';
  c += '│  └────────────────────┬─────────────────────────┘              │\n';
  c += '│                       │  SQL (parameterized queries)            │\n';
  c += '│                       ▼                                         │\n';
  c += '│  ┌──────────────────────────────────────────┐                   │\n';
  c += '│  │         PostgreSQL 15+ Database            │                 │\n';
  c += '│  │                                            │                 │\n';
  c += '│  │  Regulated Tables:                         │                 │\n';
  c += '│  │  - audit_log_event (immutable audit trail) │                 │\n';
  c += '│  │  - study/subject/event/form data           │                 │\n';
  c += '│  │  - e-signatures (SHA-256 linked)           │                 │\n';
  c += '│  │  - queries and resolutions                 │                 │\n';
  c += '│  │  - data locks/freezes                      │                 │\n';
  c += '│  │  - user accounts and permissions           │                 │\n';
  c += '│  │                                            │                 │\n';
  c += '│  │  Security:                                 │                 │\n';
  c += '│  │  - AES-256 encrypted backups               │                │\n';
  c += '│  │  - Volume-level encryption                  │                │\n';
  c += '│  │  - Automated backup scheduler               │                │\n';
  c += '│  └──────────────────────────────────────────┘                   │\n';
  c += '│                                                                 │\n';
  c += '│  Data Exports: PDF, CSV, XML, CDISC ODM                        │\n';
  c += '│  All exports include: data + metadata + audit + signatures      │\n';
  c += '└─────────────────────────────────────────────────────────────────┘\n';
  c += '```\n\n';
  c += hr();

  c += section(2, 'Audit Trail Data Flow');
  c += 'Every data mutation follows this audit path:\n\n';
  c += '```\n';
  c += 'User Action → Auth Check → RBAC Check → Validation →\n';
  c += '  → Pre-mutation snapshot (old values) →\n';
  c += '  → Database Transaction:\n';
  c += '      1. Apply data change\n';
  c += '      2. INSERT audit_log_event (who, what, when, old, new, reason)\n';
  c += '      3. COMMIT (atomic — both succeed or both fail)\n';
  c += '  → Response to user\n';
  c += '```\n\n';
  c += 'Audit trail entries are **INSERT-only**. No UPDATE or DELETE operations exist for the audit table.\n\n';
  c += hr();

  c += section(2, 'Electronic Signature Data Flow');
  c += '```\n';
  c += 'Signer initiates → Re-authentication (password entry) →\n';
  c += '  → Identity verification →\n';
  c += '  → Record snapshot (SHA-256 hash of current record state) →\n';
  c += '  → INSERT acc_esignatures:\n';
  c += '      - signer_name (printed full name)\n';
  c += '      - signed_at (UTC timestamp)\n';
  c += '      - meaning (purpose of signature)\n';
  c += '      - record_hash (SHA-256 linking to exact record version)\n';
  c += '      - event_crf_id (foreign key to signed record)\n';
  c += '  → Audit trail entry for SIGN action\n';
  c += '  → Signature manifestation displayed\n';
  c += '```\n\n';
  c += hr();

  c += approvalBlock(['System Architect', 'QA Lead', 'Project Manager']);
  c += '\n---\n*End of Document*\n';

  return c;
}

function generateAuthorizedUserListTemplate(): string {
  let c = '';

  c += documentHeader({
    title: 'Authorized User List and Access Privileges',
    documentId: `AUL-${YEAR}-001`,
    version: '1.0',
    date: DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential — Regulatory',
  });

  c += section(2, 'Purpose');
  c += 'This document maintains a cumulative record of all authorized personnel, their titles, and ';
  c += 'access privileges, as required by FDA guidance "Computerized Systems Used in Clinical Trials" ';
  c += '(April 1999), Section VII (Logical Security).\n\n';
  c += '> "There should be a cumulative record that indicates, for any point in time, the names of ';
  c += 'authorized personnel, their titles, and a description of their access privileges. The record ';
  c += 'should be in the study documentation accessible at the site." — FDA Guidance\n\n';
  c += hr();

  c += section(2, 'System Roles and Permissions');
  c += '| Role | Description | Permission Level | Data Access |\n';
  c += '|------|-------------|-----------------|-------------|\n';
  c += '| Administrator | Full system access | All 42 permissions | All studies, all sites |\n';
  c += '| Data Manager | Data quality, locks, exports | High (28 permissions) | Assigned studies |\n';
  c += '| Investigator | E-signatures, data entry/review | Clinical (18 permissions) | Assigned sites |\n';
  c += '| Coordinator (CRC) | Data entry, subject management | Operational (14 permissions) | Assigned sites |\n';
  c += '| Monitor (CRA) | SDV, queries, read-only data | Monitoring (12 permissions) | Assigned sites |\n';
  c += '| Viewer (Sponsor) | Read-only dashboards/reports | View only (6 permissions) | Assigned studies |\n\n';
  c += hr();

  c += section(2, 'Current Authorized User List');
  c += '> **Instructions:** This table must be maintained current at all times. Update when users are added, roles change, or users are deactivated. Retain historical versions.\n\n';
  c += '| # | Full Name | Username | Title/Role | System Role | Studies Assigned | Sites Assigned | Access Granted Date | Granted By | Training Completed | Status |\n';
  c += '|---|-----------|----------|-----------|-------------|-----------------|----------------|--------------------|-----------|--------------------|--------|\n';
  c += '| 1 | [Name] | [username] | [Title] | Administrator | All | All | ____/____/____ | [Approver] | [ ] Yes [ ] No | Active |\n';
  c += '| 2 | [Name] | [username] | [Title] | Data Manager | [Study IDs] | [Site IDs] | ____/____/____ | [Approver] | [ ] Yes [ ] No | Active |\n';
  c += '| 3 | [Name] | [username] | [Title] | Investigator | [Study IDs] | [Site IDs] | ____/____/____ | [Approver] | [ ] Yes [ ] No | Active |\n';
  c += '| 4 | | | | | | | | | | |\n';
  c += '| 5 | | | | | | | | | | |\n\n';
  c += hr();

  c += section(2, 'Deactivated Users');
  c += '| # | Full Name | Username | Previous Role | Deactivation Date | Deactivated By | Reason |\n';
  c += '|---|-----------|----------|--------------|-------------------|----------------|--------|\n';
  c += '| 1 | | | | | | |\n\n';
  c += hr();

  c += section(2, 'Access Review Log');
  c += '> **Instructions:** Conduct periodic access reviews per SOP-015. Document each review.\n\n';
  c += '| Review Date | Reviewed By | Users Reviewed | Changes Made | Next Review Due |\n';
  c += '|------------|------------|----------------|-------------|----------------|\n';
  c += '| ____/____/____ | _________________ | _____ | _________________ | ____/____/____ |\n\n';
  c += hr();

  c += approvalBlock(['System Administrator', 'QA Lead', 'Study Sponsor Representative']);
  c += '\n---\n*End of Document*\n';

  return c;
}

export function generate(outputDir: string, _workspaceRoot: string): void {
  const cert = generateESignatureCertification();
  fs.writeFileSync(path.join(outputDir, '17a-esignature-certification-letter.md'), cert);

  const dfd = generateDataFlowDiagram();
  fs.writeFileSync(path.join(outputDir, '17b-data-flow-diagram.md'), dfd);

  const aul = generateAuthorizedUserListTemplate();
  fs.writeFileSync(path.join(outputDir, '17c-authorized-user-list.md'), aul);
}
