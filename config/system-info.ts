/**
 * System information for the validation package.
 * Edit this file before each validation run with current system details.
 */

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
    'regulations (21 CFR Part 11), ICH E6(R2) GCP, and HIPAA where applicable.',

  architecture: {
    frontend: { name: 'Angular SPA', version: '19', runtime: 'Browser' },
    backend: { name: 'Express/Node.js REST API', version: 'Node 20+', runtime: 'Docker/Linux' },
    database: { name: 'PostgreSQL', version: '15+', type: 'Relational' },
    sharedTypes: { name: '@accura-trial/shared-types', version: 'TypeScript 5.x' },
    interopMiddleware: { name: 'FHIR-to-EDC Bridge', version: 'InversifyJS 6.x' },
    aiPipeline: { name: 'Protocol AI Pipeline', version: 'Python 3.11+, LangGraph, FastAPI' },
  },

  environments: {
    production: {
      apiUrl: 'https://api.accuratrials.com',
      frontendUrl: 'https://app.accuratrials.com',
      databaseHost: 'AWS Lightsail (PostgreSQL)',
    },
    staging: {
      apiUrl: 'https://staging-api.accuratrials.com',
      frontendUrl: 'https://staging.accuratrials.com',
      databaseHost: 'AWS Lightsail (PostgreSQL)',
    },
    development: {
      apiUrl: 'http://localhost:3100',
      frontendUrl: 'http://localhost:4200',
      databaseHost: 'localhost:5432',
    },
  },

  infrastructure: {
    hosting: 'AWS Lightsail (backend), Vercel (frontend)',
    containerization: 'Docker Compose',
    ci: 'GitHub Actions',
    monitoring: 'Docker logs, application-level audit logging',
    backups: 'AES-256 encrypted, scheduled via backup service',
  },

  projectPaths: {
    root: 'c:\\EDC Project',
    frontend: 'ElectronicDataCaptureReal',
    backend: 'libreclinicaapi',
    sharedTypes: 'shared-types',
    interopMiddleware: 'interop-middleware',
    aiPipeline: 'protocol-ai-pipeline',
    testsLive: 'tests-live',
    sopsOperational: 'ElectronicDataCaptureReal/SOPs_For_Email',
    sopsCompliance: 'ElectronicDataCaptureReal/COMPLIANCE_DOCUMENTATION',
  },
} as const;
