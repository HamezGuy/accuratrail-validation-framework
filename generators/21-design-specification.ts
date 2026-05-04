import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_INFO } from '../config/system-info';
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
  let c = '';

  c += documentHeader({
    title: 'Design Specification (DS)',
    documentId: `DS-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential - Regulatory',
  });

  c += tableOfContents([
    { level: 1, title: 'System Architecture Overview' },
    { level: 1, title: 'Database Design' },
    { level: 1, title: 'Security Architecture' },
    { level: 1, title: 'API Architecture' },
    { level: 1, title: 'Audit Trail Architecture' },
    { level: 1, title: 'Electronic Signature Architecture' },
    { level: 1, title: 'Backup and Recovery Architecture' },
    { level: 1, title: 'Deployment Architecture' },
    { level: 1, title: 'Approval Signatures' },
  ]) + '\n';
  c += hr();

  // System Architecture
  c += section(2, 'System Architecture Overview');
  c += `The **${SYSTEM_INFO.fullName}** is composed of five TypeScript projects and one Python pipeline.\n\n`;
  c += markdownTable(
    ['Component', 'Technology', 'Version', 'Purpose'],
    [
      ['Frontend', 'Angular 19 SPA', '19', 'Clinical UI - eCRF entry, review, signatures, dashboards'],
      ['Backend API', 'Express/Node.js', 'Node 20+', 'REST API - auth, authorization, business logic, audit trails'],
      ['Database', 'PostgreSQL', '15+', 'Persistent storage of all regulated electronic records'],
      ['Shared Types', '@accura-trial/shared-types', 'TS 5.x', 'Canonical DTOs for type-safe API contracts'],
      ['Interop Middleware', 'InversifyJS + Axios', '6.x', 'EHR/FHIR integration via hexagonal architecture'],
      ['AI Pipeline', 'LangGraph + FastAPI', 'Python 3.11+', 'Protocol parsing (human-reviewed, not auto-applied)'],
    ],
  );
  c += '\nData flow: Browser -> Angular SPA (Vercel) -> HTTPS REST API (AWS Lightsail) -> Route -> Middleware -> Controller -> Service -> PostgreSQL\n\n';
  c += hr();

  // Database Design
  c += section(2, 'Database Design');
  c += 'All AccuraTrial extension tables use the `acc_` prefix. Migrations run at startup via `config/migrations.ts`.\n\n';
  const tables = [
    ['acc_audit_log', 'API-level audit trail with actor, action, entity, old/new values, hash chain', '11.10(e)'],
    ['acc_esignatures', 'E-signature records with SHA-256 record hash, signer name, meaning, auto-invalidation', '11.50, 11.70'],
    ['acc_data_locks', 'Casebook and form-level freeze/lock status controlling immutability', '11.10(c)'],
    ['acc_queries', 'Clinical data query lifecycle: creation, response, resolution, escalation', 'ICH E6(R2)'],
    ['acc_tasks', 'Workflow tasks for SDV, DDE, review, data management', 'ICH E6(R2)'],
    ['acc_password_history', 'Password reuse prevention - stores hashed previous passwords', '11.300'],
    ['acc_validation_rules', 'Field-level edit check rules for eCRF data entry', '11.10(f)'],
    ['user_account_extended', 'bcrypt password hashes, upgrade tracking', '11.300'],
  ];
  c += markdownTable(['Table', 'Purpose', 'Regulatory Ref'], tables);
  c += '\nAuto-camelization: `config/database.ts` converts snake_case columns to camelCase JS properties automatically.\n\n';
  c += hr();

  // Security Architecture
  c += section(2, 'Security Architecture');
  c += '**JWT Authentication:** Login verifies bcrypt hash -> issues JWT with userId, role, permissions, exp -> auth.middleware.ts verifies on every request, checks token blocklist.\n\n';
  c += '**RBAC:** 6 roles (Admin, Data Manager, Investigator, Coordinator, Monitor, Viewer) with 42 granular permissions enforced at route and data levels.\n\n';
  c += markdownTable(
    ['Control', 'Implementation', 'Regulatory Ref'],
    [
      ['Password hashing', 'bcrypt (salt rounds 12)', '11.300'],
      ['Password expiration', '90-day configurable max age', '11.300(b)'],
      ['Password history', 'Last 5 passwords checked via acc_password_history', '11.300(b)'],
      ['Account lockout', 'Lock after 5 failed attempts, admin notification', '11.300(d)'],
      ['Token blocklist', 'Revoked tokens checked on every request', '11.10(d)'],
      ['Session revocation', 'POST /api/users/:id/revoke-sessions', '11.300(c)'],
      ['Idle timeout', 'Frontend idle detection forces re-auth', '164.312(a)(2)(iii)'],
      ['Concurrent sessions', 'Old session blocked on new login', '11.10(d)'],
      ['TLS enforcement', 'HTTPS with HSTS preload', '164.312(e)(1)'],
      ['Security headers', 'CSP, X-Frame-Options, X-Content-Type-Options', '164.312(c)(1)'],
    ],
  );
  c += '\n';
  c += hr();

  // API Architecture
  c += section(2, 'API Architecture');
  c += 'Request lifecycle: Route -> Rate Limiter -> Auth -> Authorization -> Validation -> Audit -> Part 11 -> Controller -> Service -> Response\n\n';
  c += markdownTable(
    ['Middleware', 'File', 'Purpose'],
    [
      ['Rate Limiter', 'rateLimiter.middleware.ts', 'DDoS protection via request rate limiting'],
      ['Authentication', 'auth.middleware.ts', 'JWT verification, token blocklist, user attachment'],
      ['Authorization', 'authorization.middleware.ts', 'Role and permission verification (RBAC)'],
      ['Validation', 'validation.middleware.ts', 'Joi schema validation of request body/params/query'],
      ['Audit', 'audit.middleware.ts', '21 CFR Part 11 audit trail; fails mutation if audit DB down'],
      ['Part 11', 'part11.middleware.ts', 'E-signature two-component verification, data lock enforcement'],
      ['Reason for Change', 'audit.middleware.ts (requireReasonForChange)', 'Blocks clinical data edits without reason'],
      ['Error Handler', 'errorHandler.middleware.ts', 'Global error handler; strips PHI from responses'],
    ],
  );
  c += '\n47 route files, 24 controllers covering auth, studies, subjects, forms, queries, signatures, locks, audit, export, workflows, backup.\n\n';
  c += hr();

  // Audit Trail
  c += section(2, 'Audit Trail Architecture');
  c += 'Dual mechanism: (1) audit.middleware.ts logs every API mutation, (2) audit_log_event records field-level clinical data changes.\n\n';
  c += 'SHA-256 hash chain: Each entry hash = SHA-256(content + previous_hash). Tamper detection by chain verification.\n\n';
  c += 'Immutability: INSERT-only tables, database triggers prevent UPDATE/DELETE, reason-for-change required on clinical edits.\n\n';
  c += 'PHI protection: sanitizeRequestBody() redacts patient names, DOB, SSN, diagnoses from logs.\n\n';
  c += hr();

  // E-Signatures
  c += section(2, 'Electronic Signature Architecture');
  c += 'Signing flow: User action -> re-auth prompt -> server verifies username + password (two components per 11.200) -> SHA-256 hash of record -> signature stored with signer_name, signed_at, meaning -> audit entry.\n\n';
  c += 'Record linking: SHA-256 record_hash in acc_esignatures prevents excision/copying (11.70).\n\n';
  c += 'Auto-invalidation: Record modification sets is_valid=false on existing signatures.\n\n';
  c += 'Manifestation: Exports include printed name, date/time, meaning per 11.50.\n\n';
  c += hr();

  // Backup
  c += section(2, 'Backup and Recovery Architecture');
  c += markdownTable(
    ['Component', 'Implementation', 'Details'],
    [
      ['Encryption', 'AES-256-GCM', 'Rotating encryption keys for backups at rest'],
      ['Scheduling', 'backup-scheduler.service.ts', 'Configurable automated backup intervals'],
      ['Retention', 'retention-manager.service.ts', 'Policy-based expiration of aged backups'],
      ['Cloud Storage', 'cloud-storage.service.ts', 'Offsite storage for disaster recovery'],
    ],
  );
  c += '\n';
  c += hr();

  // Deployment
  c += section(2, 'Deployment Architecture');
  c += markdownTable(
    ['Component', 'Platform', 'Details'],
    [
      ['Backend API', 'AWS Lightsail', 'Docker container with Express/Node.js'],
      ['Frontend', 'Vercel', 'Angular 19 SPA with CDN distribution'],
      ['Database', 'PostgreSQL on Lightsail', 'Persistent volume with automated backups'],
      ['CI/CD', 'GitHub Actions', 'Automated build, test, deploy pipelines'],
    ],
  );
  c += '\n';
  c += markdownTable(
    ['Environment', 'API', 'Frontend'],
    [
      ['Production', SYSTEM_INFO.environments.production.apiUrl, SYSTEM_INFO.environments.production.frontendUrl],
      ['Staging', SYSTEM_INFO.environments.staging.apiUrl, SYSTEM_INFO.environments.staging.frontendUrl],
      ['Development', SYSTEM_INFO.environments.development.apiUrl, SYSTEM_INFO.environments.development.frontendUrl],
    ],
  );
  c += '\n';
  c += hr();

  c += approvalBlock(['System Architect', 'QA Lead', 'Project Manager', 'Regulatory Affairs']);
  c += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '21-design-specification.md'), c);
}
