// Preload only for the CLI contract tests. No collector, generator, live runner,
// configured endpoint, credentials, or output filesystem is used; only the
// evidence package module touches the real filesystem, under a test's own
// temporary --retain-root or scratch output root.
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
    // The markdown helpers only build text; the master evidence index uses them.
    if (request === './generators/helpers/markdown-writer') return originalLoad.call(this, request, parent, isMain);
    if (request.startsWith('./generators/')) {
      return {
        generate(_outputDir, _workspaceRoot, options) {
          const count = (generated.get(request) || 0) + 1;
          generated.set(request, count);
          // Generator-specific options (the third argument) reach only the generator they are for.
          if (arguments.length > 2) console.log(`GENERATOR_OPTIONS ${request} ${JSON.stringify(options)}`);
          if (scenario === 'refresh-failure' && request.endsWith('06-traceability-matrix') && count === 2) {
            throw new Error('Synthetic evidence refresh failure');
          }
        },
      };
    }
    // The release identity module is pure apart from /health, which the
    // offline fetch below refuses; use the real implementation.
    // A scenario may name the API checkout the contract builds are read in (a temporary git
    // checkout, in place of the workspace's), and a framework checkout whose shared-types build and
    // node_modules install the identity records in place of this checkout's, so the live-run
    // refusal of a stale install is exercised through the CLI (IR-272).
    if (request === './runners/release-identity') {
      const real = originalLoad.call(this, request, parent, isMain);
      const apiCheckout = process.env.QUALIFICATION_CLI_TEST_API_CHECKOUT;
      const sharedTypesCheckout = process.env.QUALIFICATION_CLI_TEST_SHARED_TYPES_CHECKOUT;
      return {
        ...real,
        ...(apiCheckout ? { workspaceApiCheckout: () => apiCheckout } : {}),
        ...(sharedTypesCheckout ? {
          releaseIdentityFromInputs(inputs, options) {
            const identity = real.releaseIdentityFromInputs(inputs, options);
            const sharedTypes = real.frameworkSharedTypes(sharedTypesCheckout);
            const { sharedTypes: _own, ...framework } = identity.framework;
            return { ...identity, framework: { ...framework, ...(sharedTypes ? { sharedTypes } : {}) } };
          },
        } : {}),
      };
    }
    // The evidence package module owns every filesystem call packaging needs
    // (generate.ts makes none of its own), so a scenario that names a
    // temporary --retain-root creates, seals and verifies a real package there.
    // A scenario may name the framework checkout the package reads (a temporary git checkout),
    // so the dirty-framework refusal does not depend on this checkout's state.
    // A scratch run's folder is created under the test's own output root, never this checkout's output/.
    if (request === './runners/evidence-package') {
      const real = originalLoad.call(this, request, parent, isMain);
      const frameworkCheckout = process.env.QUALIFICATION_CLI_TEST_FRAMEWORK_CHECKOUT;
      const outputRoot = process.env.QUALIFICATION_CLI_TEST_OUTPUT_ROOT;
      return {
        ...real,
        ...(frameworkCheckout ? { createPackage: options => real.createPackage({ ...options, frameworkCheckout }) } : {}),
        createScratchRun(options) {
          if (!outputRoot) throw new Error('Offline CLI test names no QUALIFICATION_CLI_TEST_OUTPUT_ROOT');
          return real.createScratchRun({ ...options, outputRoot });
        },
      };
    }
    // The evidence module recovers what a runner journaled (IR-166) into the package or scratch folder.
    if (request === './runners/evidence-capture') return originalLoad.call(this, request, parent, isMain);
    if (request.startsWith('./runners/')) {
      if (request === './runners/benchmark-evidence') return {
        async importP13BenchmarkEvidence(_outputDir, options) {
          console.log(`OFFLINE_P13 ${options.planFile} external=${options.allowProductionQualification}`);
          return [{ testCaseId: 'P13-NATIVE-ATTACHMENT', passed: scenario === 'pass' }];
        },
        async importBenchmarkEvidence(_outputDir, options) {
          console.log(`OFFLINE_BENCHMARK ${options.runDir}`);
          return [{ testCaseId: 'BENCHMARK-RECONSTRUCTION', passed: scenario === 'pass' }];
        },
      };
      return {
        // A synthetic two-case IQ registry, for the recovery of an interrupted IQ run.
        ...(request.endsWith('/iq-runner') ? { IQ_CASE_IDS: ['IQ-001', 'IQ-002'] } : {}),
        async run(outputDir, baseUrl, _workspaceRoot, flags, options) {
          if (!['https://qualification.invalid', process.env.QUALIFICATION_CLI_TEST_TARGET].includes(baseUrl)) throw new Error('Unexpected test target');
          console.log(`OFFLINE_RUNNER ${request}`);
          console.log(`OFFLINE_TARGET ${baseUrl}`);
          if (flags?.length) console.log(`QUALIFICATION_FLAGS ${flags.join(",")}`);
          // Runner-specific options (the fifth argument) reach only the runner they are for.
          if (arguments.length > 4) console.log(`RUNNER_OPTIONS ${request} ${JSON.stringify(options)}`);
          if (request.endsWith('/iq-runner')) {
            if (scenario === 'throw') throw new Error('Synthetic runner failure');
            if (scenario === 'undefined') return undefined;
            if (scenario === 'empty') return [];
            if (scenario === 'malformed') return [{ testCaseId: 'IQ-001', passed: 'true' }];
            // IR-166: IQ-001 is journaled, then the runner throws, or the run receives SIGINT and never returns.
            if (scenario === 'journal-throw' || scenario === 'interrupt') {
              const { appendCaseJournal } = require(path.resolve(__dirname, '../../runners/evidence-capture'));
              appendCaseJournal(outputDir, 'iq', [{ testCaseId: 'IQ-001', timestamp: '2026-09-09T00:00:00.000Z', endpoint: '/offline-test', method: 'GET',
                responseStatus: 200, responseBody: { synthetic: true }, passed: true, notes: 'Synthetic journaled case; no system qualification claim.' }]);
              if (scenario === 'journal-throw') throw new Error('Synthetic runner stopped after a journaled case');
              setImmediate(() => process.emit('SIGINT', 'SIGINT'));
              return new Promise(() => undefined);
            }
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
