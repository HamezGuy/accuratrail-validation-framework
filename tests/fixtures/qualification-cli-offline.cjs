// Preload only for the CLI contract tests. No collector, generator, live runner,
// configured endpoint, credentials, or output filesystem is used.
const Module = require('node:module');
const path = require('node:path');
const originalLoad = Module._load;
const entrypoint = path.resolve(__dirname, '../../generate.ts');
const scenario = process.env.QUALIFICATION_CLI_TEST_SCENARIO;
const generated = new Map();
const virtualFs = {
  mkdirSync() {},
  existsSync() { return false; },
  readdirSync() { return []; },
  writeFileSync() {},
  symlinkSync() {},
};

globalThis.fetch = async () => { throw new Error('Offline CLI test attempted network access'); };

Module._load = function (request, parent, isMain) {
  if (parent?.filename === entrypoint) {
    if (request === 'fs') return virtualFs;
    if (request.startsWith('./collectors/')) {
      if (scenario === 'collector-failure' && request.endsWith('/route-collector')) {
        throw new Error('Synthetic required collector failure');
      }
      return {};
    }
    if (request.startsWith('./generators/')) {
      return {
        generate() {
          const count = (generated.get(request) || 0) + 1;
          generated.set(request, count);
          if (scenario === 'refresh-failure' && request.endsWith('06-traceability-matrix') && count === 2) {
            throw new Error('Synthetic evidence refresh failure');
          }
        },
      };
    }
    if (request.startsWith('./runners/')) {
      return {
        async run(_outputDir, baseUrl) {
          if (baseUrl !== 'https://qualification.invalid') throw new Error('Unexpected test target');
          console.log(`OFFLINE_RUNNER ${request}`);
          if (request.endsWith('/iq-runner')) {
            if (scenario === 'throw') throw new Error('Synthetic runner failure');
            if (scenario === 'undefined') return undefined;
            if (scenario === 'empty') return [];
            if (scenario === 'malformed') return [{ testCaseId: 'IQ-001', passed: 'true' }];
          }
          return [{
            testCaseId: `${request}-001`,
            timestamp: '2026-09-09T00:00:00.000Z',
            endpoint: '/offline-test',
            method: 'GET',
            responseStatus: 200,
            responseBody: { synthetic: true },
            passed: !(scenario === 'failed-result' && request.endsWith('/iq-runner')),
            notes: 'Synthetic orchestration evidence; no system qualification claim.',
          }];
        },
      };
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};
