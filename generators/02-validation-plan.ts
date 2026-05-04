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
  let content = '';

  content += documentHeader({
    title: 'Validation Master Plan (VMP)',
    documentId: `VMP-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential — Regulatory',
  });

  content += tableOfContents([
    { level: 1, title: 'Introduction' },
    { level: 1, title: 'Validation Strategy' },
    { level: 1, title: 'System Architecture' },
    { level: 1, title: 'Validation Phases' },
    { level: 1, title: 'Part 11 Validation Scope' },
    { level: 1, title: 'HIPAA Validation Scope' },
    { level: 1, title: 'Roles and Responsibilities' },
    { level: 1, title: 'Validation Schedule' },
    { level: 1, title: 'Validation Environment' },
    { level: 1, title: 'Acceptance Criteria' },
    { level: 1, title: 'Deviation Handling' },
    { level: 1, title: 'Document Deliverables' },
    { level: 1, title: 'Approval Signatures' },
  ]) + '\n';

  content += hr();

  // Section 1
  content += section(2, 'Introduction');
  content += section(3, 'Purpose');
  content += 'This Validation Master Plan (VMP) defines the strategy, scope, approach, schedule, ' +
    `and deliverables for the computer system validation of **${SYSTEM_INFO.fullName}** ` +
    `(v${SYSTEM_INFO.version}). ` +
    'The validation program establishes documented evidence that the system consistently performs ' +
    'its intended functions in compliance with 21 CFR Part 11, HIPAA Security Rule, and ICH E6(R2) GCP.\n\n';

  content += section(3, 'Scope');
  content += 'This VMP covers the complete validation lifecycle for all regulated functionality:\n\n';
  content += '- All electronic records created, modified, maintained, archived, retrieved, or transmitted\n';
  content += '- All electronic signature capabilities\n';
  content += '- All ePHI handling, storage, and transmission\n';
  content += '- All access controls, audit trails, and data integrity mechanisms\n';
  content += '- Installation, operational, and performance qualification of all system components\n\n';

  content += section(3, 'System Overview');
  content += `${SYSTEM_INFO.description}\n\n`;
  content += `**Intended Use:** ${SYSTEM_INFO.intendedUse}\n\n`;
  content += hr();

  // Section 2
  content += section(2, 'Validation Strategy');
  content += section(3, 'Risk-Based Approach');
  content += 'The validation effort follows a risk-based approach as recommended by the GAMP 5 framework ' +
    'and FDA guidance on 21 CFR Part 11. Validation rigor is proportional to the risk each feature poses ' +
    'to subject safety, data integrity, and regulatory compliance.\n\n';
  content += '- **Critical-risk features** receive full IQ/OQ/PQ with documented evidence for every requirement\n';
  content += '- **High-risk features** receive OQ/PQ with targeted test cases\n';
  content += '- **Medium-risk features** receive OQ with representative test cases\n';
  content += '- **Low-risk features** receive verification via code review and exploratory testing\n\n';

  content += section(3, 'IQ/OQ/PQ Methodology');
  content += 'The validation follows the industry-standard three-phase qualification model:\n\n';
  content += '1. **Installation Qualification (IQ)** — Verifies that the system is installed correctly ' +
    'and all components are present and configured as specified.\n';
  content += '2. **Operational Qualification (OQ)** — Verifies that the system operates according to ' +
    'its functional requirements under normal and boundary conditions.\n';
  content += '3. **Performance Qualification (PQ)** — Verifies that the system performs as intended ' +
    'under real-world conditions with representative clinical data and workflows.\n\n';

  content += section(3, 'Standards and References');
  content += '- 21 CFR Part 11 — Electronic Records; Electronic Signatures\n';
  content += '- GAMP 5 — A Risk-Based Approach to Compliant GxP Computerized Systems\n';
  content += '- FDA Guidance: General Principles of Software Validation (2002)\n';
  content += '- FDA Guidance: Part 11, Scope and Application (2003)\n';
  content += '- ICH E6(R2) — Guideline for Good Clinical Practice\n';
  content += '- 45 CFR 164 — HIPAA Security Rule\n';
  content += '- NIST SP 800-53 — Security and Privacy Controls (reference framework)\n\n';
  content += hr();

  // Section 3: System Architecture
  content += section(2, 'System Architecture');
  content += `The ${SYSTEM_INFO.fullName} comprises five TypeScript projects and one Python pipeline:\n\n`;

  const archItems: [string, string, string, string][] = [
    [
      'Frontend (Angular SPA)',
      SYSTEM_INFO.architecture.frontend.name,
      SYSTEM_INFO.architecture.frontend.version,
      'Clinical user interface for data entry, queries, reports, and administration. ' +
      'Standalone components with NgRx state management for authentication. ' +
      'Role-based guards restrict UI access.',
    ],
    [
      'Backend REST API',
      SYSTEM_INFO.architecture.backend.name,
      SYSTEM_INFO.architecture.backend.version,
      'Central business logic layer. Route → Middleware → Controller → Service architecture. ' +
      'Handles authentication, authorization, audit logging, e-signatures, data locks, queries, ' +
      'validation rules, randomization, and all CRUD operations. Direct SQL via pg Pool (no ORM).',
    ],
    [
      'Shared Types',
      SYSTEM_INFO.architecture.sharedTypes.name,
      SYSTEM_INFO.architecture.sharedTypes.version,
      'Canonical DTO definitions shared between frontend and backend. Ensures type-safe API contracts. ' +
      'Includes request DTOs, response DTOs, and entity interfaces.',
    ],
    [
      'Interop Middleware',
      SYSTEM_INFO.architecture.interopMiddleware.name,
      SYSTEM_INFO.architecture.interopMiddleware.version,
      'FHIR-to-EDC bridge for EHR integration. Hexagonal architecture with InversifyJS DI. ' +
      'Supports Epic, Cerner, and sandbox adapters. SMART on FHIR authorization flow.',
    ],
    [
      'AI Pipeline',
      SYSTEM_INFO.architecture.aiPipeline.name,
      SYSTEM_INFO.architecture.aiPipeline.version,
      'Protocol document parsing and CRF generation via LangGraph agents. FastAPI server. ' +
      'All AI-generated outputs require human review before use in regulated workflows.',
    ],
  ];

  content += markdownTable(
    ['Component', 'Technology', 'Version', 'Description'],
    archItems,
  );
  content += '\n';

  content += section(3, 'Data Flow');
  content += '```\n';
  content += 'Browser → Angular SPA → REST API (Express) → Controllers → Services → PostgreSQL\n';
  content += '                                             → SOAP (LibreClinica legacy, optional)\n';
  content += '                                             → FHIR (interop-middleware, scaffolding)\n';
  content += '```\n\n';
  content += 'The request lifecycle: **Route → Middleware (auth, validation) → Controller → Service → Database**\n\n';
  content += hr();

  // Section 4: Validation Phases
  content += section(2, 'Validation Phases');

  content += section(3, 'Installation Qualification (IQ)');
  content += '**Objective:** Verify that all system components are installed correctly and match ' +
    'the approved specifications.\n\n';
  content += '**Scope:**\n\n';
  content += '- Verify all software dependencies are installed at specified versions\n';
  content += '- Verify database schema matches migration specifications\n';
  content += '- Verify environment configuration (environment variables, TLS certificates, DNS)\n';
  content += '- Verify Docker container images and orchestration configuration\n';
  content += '- Verify network connectivity between all system components\n';
  content += '- Verify file system permissions and directory structure\n';
  content += '- Verify backup infrastructure (encryption keys, storage locations, schedules)\n';
  content += '- Verify monitoring and logging infrastructure\n\n';
  content += '**Deliverables:** IQ Protocol, IQ Execution Records, IQ Summary Report\n\n';

  content += section(3, 'Operational Qualification (OQ)');
  content += '**Objective:** Verify that the system operates according to functional requirements ' +
    'under normal operating conditions, boundary conditions, and error conditions.\n\n';
  content += '**Scope:**\n\n';
  content += '- Test all authentication and access control mechanisms\n';
  content += '- Test audit trail generation, content, and immutability\n';
  content += '- Test electronic signature creation, components, linking, and non-repudiation\n';
  content += '- Test eCRF data entry, validation rules, skip logic, and calculations\n';
  content += '- Test query creation, response, resolution, and escalation workflows\n';
  content += '- Test data freeze, data lock, and unlock workflows\n';
  content += '- Test subject enrollment, visit scheduling, and randomization\n';
  content += '- Test data export in all formats (PDF, CSV, XML, ODM)\n';
  content += '- Test backup and restore procedures\n';
  content += '- Test session management, idle timeout, and concurrent session controls\n';
  content += '- Test encryption at rest and in transit\n';
  content += '- Boundary testing: empty inputs, maximum lengths, special characters, concurrent access\n';
  content += '- Negative testing: invalid credentials, unauthorized access, malformed requests\n\n';
  content += '**Deliverables:** OQ Protocol, OQ Test Scripts, OQ Execution Records, OQ Summary Report\n\n';

  content += section(3, 'Performance Qualification (PQ)');
  content += '**Objective:** Verify that the system performs as intended under real-world conditions ' +
    'using representative clinical trial data and workflows.\n\n';
  content += '**Scope:**\n\n';
  content += '- End-to-end clinical workflow: study setup → site activation → subject enrollment → ' +
    'data entry → query management → SDV → data lock → export\n';
  content += '- Multi-user concurrent access scenarios\n';
  content += '- Multi-site, multi-study operation\n';
  content += '- Performance under expected production load\n';
  content += '- Disaster recovery drill (backup, restore, verify data integrity)\n';
  content += '- Regulatory inspection simulation (audit trail export, record retrieval)\n\n';
  content += '**Deliverables:** PQ Protocol, PQ Execution Records, PQ Summary Report\n\n';
  content += hr();

  // Section 5: Part 11 Validation Scope
  content += section(2, 'Part 11 Validation Scope');
  content += 'The following 21 CFR Part 11 sections will be validated:\n\n';

  const part11Sections: [string, string, string][] = [
    ['11.10(a)', 'Validation', 'System validated per GAMP 5; IQ/OQ/PQ documented'],
    ['11.10(b)', 'Accurate and complete copies', 'PDF/CSV/XML/ODM export verified for accuracy'],
    ['11.10(c)', 'Record protection', 'Backup encryption, access controls, retention verified'],
    ['11.10(d)', 'Limiting system access', 'RBAC, authentication, session management verified'],
    ['11.10(e)', 'Audit trails', 'Generation, content, immutability, export verified'],
    ['11.10(f)', 'Operational system checks', 'Sequencing, validation rules, workflow enforcement verified'],
    ['11.10(g)', 'Authority checks', 'Role-based authorization for all operations verified'],
    ['11.10(h)', 'Device checks', 'Device fingerprinting, session binding verified'],
    ['11.10(i)', 'Training', 'Training records, role-based training modules verified'],
    ['11.10(j)', 'Documentation accountability', 'Policies, SOPs, change control verified'],
    ['11.10(k)(1)', 'Documentation controls — distribution', 'Controlled document distribution verified'],
    ['11.10(k)(2)', 'Documentation controls — revision', 'Revision history and change tracking verified'],
    ['11.50', 'Signature manifestations', 'Printed name, date/time, meaning displayed and stored'],
    ['11.70', 'Signature/record linking', 'Cryptographic hash linking verified'],
    ['11.100', 'General e-signature requirements', 'Uniqueness, identity verification, FDA certification'],
    ['11.200', 'E-signature components/controls', 'Two-component signatures, re-authentication'],
    ['11.300', 'Controls for ID codes/passwords', 'Password complexity, expiration, uniqueness'],
  ];

  content += markdownTable(
    ['Section', 'Title', 'Validation Approach'],
    part11Sections,
  );
  content += '\n';
  content += hr();

  // Section 6: HIPAA Validation Scope
  content += section(2, 'HIPAA Validation Scope');
  content += 'The following HIPAA Security Rule sections will be validated:\n\n';

  const hipaaSections: [string, string, string][] = [
    ['164.312(a)(1)', 'Access control', 'RBAC, unique accounts, emergency access procedures'],
    ['164.312(a)(2)(i)', 'Unique user identification', 'Unique usernames, no shared accounts'],
    ['164.312(a)(2)(iii)', 'Automatic logoff', 'Idle timeout, session expiration'],
    ['164.312(a)(2)(iv)', 'Encryption and decryption', 'AES-256 at rest, TLS in transit'],
    ['164.312(b)', 'Audit controls', 'Audit logging of all ePHI access and modification'],
    ['164.312(c)(1)', 'Integrity', 'Data validation, checksums, immutable audit trails'],
    ['164.312(d)', 'Person or entity authentication', 'Multi-factor capability, password controls'],
    ['164.312(e)(1)', 'Transmission security', 'TLS 1.2+, certificate validation'],
    ['164.308(a)(7)', 'Contingency plan', 'Backup, disaster recovery, emergency mode'],
    ['164.404', 'Breach notification', 'Breach detection, notification procedures'],
  ];

  content += markdownTable(
    ['Section', 'Title', 'Validation Approach'],
    hipaaSections,
  );
  content += '\n';
  content += hr();

  // Section 7: Roles and Responsibilities
  content += section(2, 'Roles and Responsibilities');
  content += markdownTable(
    ['Role', 'Name', 'Responsibilities'],
    [
      ['QA Lead', '________________', 'Owns the VMP; reviews and approves all validation deliverables; ' +
        'conducts deviation reviews; signs final validation summary report'],
      ['Project Manager', '________________', 'Manages validation schedule and resources; coordinates ' +
        'between QA, development, and operations; tracks deviations and CAPAs'],
      ['Lead Developer', '________________', 'Executes IQ/OQ test scripts; provides technical ' +
        'clarification; remediates defects found during qualification; maintains traceability'],
      ['System Administrator', '________________', 'Provides environment access; executes infrastructure ' +
        'IQ checks; manages deployment; maintains backup and recovery systems'],
      ['Regulatory Affairs', '________________', 'Reviews regulatory applicability assessment; confirms ' +
        'predicate rule coverage; reviews traceability matrix for completeness'],
      ['Clinical Operations', '________________', 'Participates in PQ; validates clinical workflows ' +
        'against actual trial processes; provides subject-matter expertise'],
    ],
  );
  content += '\n';
  content += hr();

  // Section 8: Validation Schedule
  content += section(2, 'Validation Schedule');
  content += markdownTable(
    ['Phase', 'Activity', 'Duration', 'Start Date', 'End Date', 'Owner'],
    [
      ['1', 'Validation planning (VMP, URS, risk assessment)', '2 weeks', 'TBD', 'TBD', 'QA Lead'],
      ['2', 'Requirements specification (FRS)', '1 week', 'TBD', 'TBD', 'Lead Developer'],
      ['3', 'IQ protocol development and execution', '1 week', 'TBD', 'TBD', 'System Admin'],
      ['4', 'OQ protocol development', '2 weeks', 'TBD', 'TBD', 'QA Lead / Developer'],
      ['5', 'OQ test execution', '2 weeks', 'TBD', 'TBD', 'Lead Developer'],
      ['6', 'PQ protocol development', '1 week', 'TBD', 'TBD', 'QA Lead'],
      ['7', 'PQ test execution', '2 weeks', 'TBD', 'TBD', 'Clinical Ops / Developer'],
      ['8', 'Deviation review and remediation', '1 week', 'TBD', 'TBD', 'QA Lead'],
      ['9', 'Validation summary report', '1 week', 'TBD', 'TBD', 'QA Lead'],
      ['10', 'Final approval and release', '1 week', 'TBD', 'TBD', 'All Signatories'],
    ],
  );
  content += '\n';
  content += '**Total Estimated Duration:** 14 weeks\n\n';
  content += hr();

  // Section 9: Validation Environment
  content += section(2, 'Validation Environment');
  content += 'All qualification testing will be performed in a dedicated validation environment ' +
    'that mirrors the production configuration:\n\n';
  content += markdownTable(
    ['Component', 'Specification'],
    [
      ['Operating System', 'Ubuntu Linux (Docker host) / Windows 10+ (client)'],
      ['Backend Runtime', `${SYSTEM_INFO.architecture.backend.version}`],
      ['Frontend Runtime', `${SYSTEM_INFO.architecture.frontend.name} ${SYSTEM_INFO.architecture.frontend.version}`],
      ['Database', `${SYSTEM_INFO.architecture.database.name} ${SYSTEM_INFO.architecture.database.version}`],
      ['Containerization', SYSTEM_INFO.infrastructure.containerization],
      ['TLS', 'TLS 1.2+ with valid certificates'],
      ['Browser', 'Chrome (latest), Firefox (latest), Edge (latest)'],
      ['Network', 'Isolated VLAN or equivalent logical separation from production'],
    ],
  );
  content += '\n';
  content += '**Data:** The validation environment will use synthetic clinical trial data. ' +
    'No real patient/subject data will be used during qualification testing.\n\n';
  content += hr();

  // Section 10: Acceptance Criteria
  content += section(2, 'Acceptance Criteria');
  content += section(3, 'Installation Qualification (IQ)');
  content += '- All software components installed at documented versions\n';
  content += '- All environment variables configured per specification\n';
  content += '- Database schema matches migration specifications exactly\n';
  content += '- All network connectivity tests pass\n';
  content += '- Zero critical or high deviations\n\n';

  content += section(3, 'Operational Qualification (OQ)');
  content += '- 100% of Critical-risk test cases executed and passed\n';
  content += '- 100% of High-risk test cases executed and passed\n';
  content += '- ≥95% of Medium-risk test cases passed (remaining covered by approved deviations)\n';
  content += '- All Part 11 compliance test cases passed\n';
  content += '- All HIPAA security test cases passed\n';
  content += '- All audit trail tests confirm complete, immutable, computer-generated logs\n';
  content += '- All e-signature tests confirm two-component auth with required manifestations\n';
  content += '- Zero unresolved Critical deviations; all High deviations have approved CAPAs\n\n';

  content += section(3, 'Performance Qualification (PQ)');
  content += '- End-to-end clinical workflow completes successfully\n';
  content += '- Multi-user concurrent access operates without data corruption\n';
  content += '- System responds within acceptable performance thresholds under load\n';
  content += '- Backup and restore cycle completes with verified data integrity\n';
  content += '- All exported records match source data exactly\n\n';
  content += hr();

  // Section 11: Deviation Handling
  content += section(2, 'Deviation Handling');
  content += section(3, 'Deviation Classification');
  content += markdownTable(
    ['Severity', 'Definition', 'Action Required'],
    [
      ['Critical', 'Affects subject safety, data integrity, or regulatory compliance', 'Immediate remediation; re-test; CAPA required; QA approval before proceeding'],
      ['Major', 'Significant functional failure but no direct regulatory impact', 'Remediation required; re-test; CAPA may be required'],
      ['Minor', 'Cosmetic or usability issue with no data/compliance impact', 'Document and track; remediation in next release acceptable'],
    ],
  );
  content += '\n';

  content += section(3, 'Deviation Process');
  content += '1. **Detection** — Tester documents the deviation with full details (expected vs. actual, screenshots, logs)\n';
  content += '2. **Classification** — QA Lead classifies severity (Critical / Major / Minor)\n';
  content += '3. **Root Cause Analysis** — Developer investigates and documents root cause\n';
  content += '4. **Remediation** — Developer implements fix; fix undergoes code review\n';
  content += '5. **Re-Test** — Original test case re-executed; results documented\n';
  content += '6. **CAPA** — For Critical/Major: Corrective and Preventive Action documented\n';
  content += '7. **Closure** — QA Lead reviews and approves deviation closure\n\n';
  content += hr();

  // Section 12: Document Deliverables
  content += section(2, 'Document Deliverables');
  content += 'The validation framework generates the following deliverables:\n\n';

  content += markdownTable(
    ['#', 'Document', 'Document ID', 'Description'],
    [
      ['01', 'Applicability Assessment', `APP-${DOC_YEAR}-001`, 'Part 11/HIPAA regulatory applicability determination'],
      ['02', 'Validation Master Plan', `VMP-${DOC_YEAR}-001`, 'This document — strategy, scope, schedule'],
      ['03', 'User Requirements Specification', `URS-${DOC_YEAR}-001`, 'Business/regulatory requirements'],
      ['04', 'Functional Requirements Specification', `FRS-${DOC_YEAR}-001`, 'System functional requirements with implementation mapping'],
      ['05', 'Risk Assessment', `RA-${DOC_YEAR}-001`, 'Feature-level risk assessment and mitigation'],
      ['06', 'Traceability Matrix', `TM-${DOC_YEAR}-001`, 'Regulation → requirement → implementation → test cross-reference'],
      ['07', 'IQ Protocol', `IQ-${DOC_YEAR}-001`, 'Installation qualification test protocol'],
      ['08', 'IQ Execution Evidence', `IQE-${DOC_YEAR}-001`, 'IQ test execution results and evidence'],
      ['09', 'OQ Protocol', `OQ-${DOC_YEAR}-001`, 'Operational qualification test protocol'],
      ['10', 'OQ Execution Evidence', `OQE-${DOC_YEAR}-001`, 'OQ test execution results and evidence'],
      ['11', 'PQ Protocol', `PQ-${DOC_YEAR}-001`, 'Performance qualification test protocol'],
      ['12', 'PQ Execution Evidence', `PQE-${DOC_YEAR}-001`, 'PQ test execution results and evidence'],
      ['13', 'Validation Summary Report', `VSR-${DOC_YEAR}-001`, 'Overall validation summary with pass/fail determination'],
      ['14', 'Part 11 Compliance Matrix', `P11-${DOC_YEAR}-001`, 'Detailed Part 11 section-by-section compliance evidence'],
      ['15', 'HIPAA Security Assessment', `HSA-${DOC_YEAR}-001`, 'HIPAA Security Rule compliance assessment'],
      ['16', 'Change Control Log', `CCL-${DOC_YEAR}-001`, 'Post-validation change tracking'],
    ],
  );
  content += '\n';
  content += hr();

  // Approval
  content += approvalBlock([
    'Quality Assurance Lead',
    'Project Manager',
    'Lead Developer',
    'System Administrator',
    'Regulatory Affairs',
  ]);

  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '02-validation-plan.md'), content);
}
