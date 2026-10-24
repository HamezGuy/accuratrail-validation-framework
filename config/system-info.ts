/**
 * System information for the validation package.
 * Edit this file before each validation run with current system details.
 *
 * The production topology is the one libreclinicaapi
 * production-deployment/DEPLOY_ECS.md:9-21 documents: ECS Fargate in us-east-2
 * running the API, core and training services, RDS PostgreSQL 14
 * (accuratrials-hipaa-db) and the /ecs/accuratrials/api log group. The frontend
 * deploys to Vercel (EDCProjectCompliant/vercel.json). The Intelligence Layer is
 * a separate system, not part of this release. The System Owner confirms this
 * description before the package is approved.
 */

import { ICH_E6_R3 } from './regulatory-scope';

export const SYSTEM_INFO = {
  name: 'AccuraTrial EDC',
  fullName: 'AccuraTrial Electronic Data Capture System',
  vendor: 'AccuraTrial Inc.',
  version: '1.0.0',
  buildDate: new Date().toISOString().split('T')[0],

  description:
    'A 21 CFR Part 11-compliant Electronic Data Capture (EDC) system for clinical trials. ' +
    'Manages electronic Case Report Forms (eCRFs), subject enrollment, visit scheduling, ' +
    'data queries, electronic signatures, audit trails, and regulatory data exports.',

  intendedUse:
    'Capture, store, manage, and report clinical trial data in compliance with FDA ' +
    `regulations (21 CFR Part 11), ${ICH_E6_R3.citation} GCP, and HIPAA where applicable. ` +
    'For the TA3 platform trial uses it is also intended to detect and record protocol deviations with ' +
    'their assessment and corrective actions, to apply the governing protocol version at each site, and to ' +
    'retain operational milestones, measurement documents and inspection copies; the deviation engine is ' +
    'enabled in production only through change control.',

  architecture: {
    // The @angular/core major EDCProjectCompliant/package.json declares (^20.3.27);
    // IQ-005 compares the two and test:cross-repo keeps them equal.
    frontend: { name: 'Angular SPA', version: '20', runtime: 'Browser' },
    backend: { name: 'Express/Node.js REST API', version: 'Node 20+', runtime: 'Docker/Linux' },
    // The engine version only: the OQ and PQ test environment tables print it
    // for a test stack too, so the AWS RDS hosting stays in the rows below.
    database: { name: 'PostgreSQL', version: '14', type: 'Relational; AWS RDS in production' },
    sharedTypes: { name: '@accura-trial/shared-types', version: 'TypeScript 5.x' },
    interopMiddleware: { name: 'FHIR-to-EDC Bridge', version: 'InversifyJS 6.x' },
    aiPipeline: { name: 'Intelligence Layer (separate system; see the platform inventory)', version: 'Not part of the EDC release' },
  },

  environments: {
    production: {
      apiUrl: 'https://api.accuratrials.com',
      frontendUrl: 'https://app.accuratrials.com',
      databaseHost: 'AWS RDS PostgreSQL 14 (accuratrials-hipaa-db)',
    },
    // The URLs stay listed so the CLI keeps treating them as staging, not
    // production; no deployment document describes a staging database.
    staging: {
      apiUrl: 'https://staging-api.accuratrials.com',
      frontendUrl: 'https://staging.accuratrials.com',
      databaseHost: 'not documented',
    },
    development: {
      apiUrl: 'http://localhost:3100',
      frontendUrl: 'http://localhost:4200',
      databaseHost: 'localhost:5432',
    },
  },

  infrastructure: {
    hosting: 'AWS ECS Fargate in us-east-2 (API, core and training services); frontend on Vercel per EDCProjectCompliant/vercel.json',
    containerization: 'Docker images on ECS',
    ci: 'GitHub Actions',
    monitoring: 'CloudWatch log group /ecs/accuratrials/api, application-level audit logging',
    backups: 'AES-256 encrypted, scheduled via backup service',
  },

  projectPaths: {
    root: 'C:\\Projects\\EDCProject',
    frontend: 'EDCProjectCompliant',
    backend: 'libreclinicaapi',
    sharedTypes: 'accuratrial-shared-types',
    interopMiddleware: 'accuratrial-interop-middleware',
    trainingModule: 'accura-training-module',
    validationFramework: 'accuratrail-validation-framework',
    // A separate system outside the EDC workspace.
    aiPipeline: '..\\IntellegenceLayer\\EDCProtocolToECRF',
    testsLive: 'accuratrial-tests-live',
    sopsOperational: 'EDCProjectCompliant/SOPs_For_Email',
    sopsCompliance: 'EDCProjectCompliant/COMPLIANCE_DOCUMENTATION',
  },
} as const;
