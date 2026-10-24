import * as fs from 'fs';
import * as path from 'path';
import type { EvidenceResult } from './runners/evidence-capture';
import { SYSTEM_INFO } from './config/system-info';
import {
  observeTargetVersion, releaseIdentityFromInputs, releaseIndexCells, releaseSummary, requireTrainingRelease, setReleaseIdentity,
  type ReleaseComponentName, type ReleaseIdentity,
} from './runners/release-identity';
import { approvalBlock, masterEvidenceIndexHeader, registryCasesText } from './generators/helpers/markdown-writer';
import {
  benchmarkRunInputs, checkPlatformEvidencePlan, checkTa3OqPlan, checkTargetConfiguration, createPackage, markDevelopmentRun,
  sealPackage, syntheticBasis, DEVELOPMENT_RUN_NOTICE, PLATFORM_EVIDENCE_STATUSES, type EvidencePackage, type PackageInputSource,
} from './runners/evidence-package';
import { ALL_OQ_SUITES, parseOqSuiteSelection, type OqSuiteSelection } from './config/oq-case-registry';

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

interface CliArgs {
  docsOnly: boolean;
  runIq: boolean;
  runOq: boolean;
  runPq: boolean;
  runSecurity: boolean;
  runDr: boolean;
  runPerf: boolean;
  only?: string;
  version?: string;
  baseUrl?: string;
  allowProductionTarget: boolean;
  releaseInputs: Partial<Record<ReleaseComponentName, string>>;
  releaseIdentity?: ReleaseIdentity;
  benchmarkRun?: string;
  benchmarkEvaluatorRoot?: string;
  p13Plan?: string;
  trainingEvidence?: string;
  qualificationFlags: string[];
  /** Create and seal a retained evidence package under this directory. */
  retainRoot?: string;
  /** A development run: output/ scratch, every record and document marked not retained. */
  noRetain: boolean;
  /** The validation-target-configuration/1 declaration of the live runners' target (IQ-033). */
  targetConfig?: string;
  /** The ta3-oq-plan/1 the OQ suites 13 to 18 run from. */
  ta3OqPlan?: string;
  /** `--oq-suites`: the OQ suites to run; every suite when absent. */
  oqSuites?: OqSuiteSelection;
  /** The platform-validation-evidence-plan/1 the platform summary (document 22) checks by hash. */
  platformEvidence?: string;
  /** `--platform-root`: the parent of the estate repositories the platform summary reads. */
  platformRoot?: string;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const args: CliArgs = {
    docsOnly: false,
    runIq: false,
    runOq: false,
    runPq: false,
    runSecurity: false,
    runDr: false,
    runPerf: false,
    only: undefined,
    version: undefined,
    baseUrl: undefined,
    allowProductionTarget: false,
    releaseInputs: {},
    qualificationFlags: [],
    noRetain: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--docs-only':
        args.docsOnly = true;
        break;
      case '--iq':
        args.runIq = true;
        break;
      case '--oq':
        args.runOq = true;
        break;
      case '--pq':
        args.runPq = true;
        break;
      case '--security':
        args.runSecurity = true;
        break;
      case '--dr':
        args.runDr = true;
        break;
      case '--perf':
        args.runPerf = true;
        break;
      case '--all':
        args.runIq = true;
        args.runOq = true;
        args.runPq = true;
        args.runSecurity = true;
        args.runDr = true;
        args.runPerf = true;
        break;
      case '--only':
        i++;
        args.only = argv[i];
        break;
      case '--version':
        i++;
        args.version = argv[i];
        break;
      case '--base-url': {
        const value = argv[++i];
        if (!value || value.startsWith('--')) throw new Error('--base-url requires a URL');
        args.baseUrl = value;
        break;
      }
      case '--allow-production-target':
        args.allowProductionTarget = true;
        break;
      case '--release-api':
      case '--release-ui':
      case '--release-core':
      case '--release-training': {
        // The UI, core and training may be stated as `none` (not deployed); the API may not.
        const value = argv[++i];
        if (!value || value.startsWith('--')) {
          throw new Error(`${arg} requires a Git commit or image ID${arg === '--release-api' ? '' : ', or none'}`);
        }
        args.releaseInputs[arg.slice('--release-'.length) as ReleaseComponentName] = value;
        break;
      }
      case '--benchmark-run':
      case '--p13-plan':
      case '--training-evidence':
      case '--benchmark-evaluator-root':
      case '--target-config':
      case '--ta3-oq-plan':
      case '--platform-evidence':
      case '--platform-root': {
        const value = argv[++i];
        if (!value || value.startsWith('--')) throw new Error(`${arg} requires a ${arg === '--platform-root' ? 'directory' : 'path'}`);
        if (arg === '--benchmark-run') args.benchmarkRun = value;
        else if (arg === '--p13-plan') args.p13Plan = value;
        else if (arg === '--training-evidence') args.trainingEvidence = value;
        else if (arg === '--target-config') args.targetConfig = value;
        else if (arg === '--ta3-oq-plan') args.ta3OqPlan = value;
        else if (arg === '--platform-evidence') args.platformEvidence = value;
        else if (arg === '--platform-root') args.platformRoot = value;
        else args.benchmarkEvaluatorRoot = value;
        break;
      }
      case '--oq-suites': {
        const value = argv[++i];
        if (!value || value.startsWith('--')) throw new Error('--oq-suites requires a list of suites, for example 13-18');
        args.oqSuites = parseOqSuiteSelection(value);
        break;
      }
      case '--synthetic-qualification':
      case '--allow-production-qualification':
      case '--acknowledge-ungoverned':
      case '--acknowledge-incomplete':
        args.qualificationFlags.push(arg);
        break;
      case '--retain-root': {
        const value = argv[++i];
        if (!value || value.startsWith('--')) throw new Error('--retain-root requires a directory');
        args.retainRoot = value;
        break;
      }
      case '--no-retain':
        args.noRetain = true;
        break;
      default:
        console.warn(`  [WARN] Unknown argument: ${arg}`);
    }
  }

  if (args.benchmarkEvaluatorRoot && !args.benchmarkRun) throw new Error('--benchmark-evaluator-root requires --benchmark-run');
  if (args.retainRoot && args.noRetain) throw new Error('Pass --retain-root or --no-retain, not both.');
  // A documents run reads no declaration, as it imports no evidence.
  if (args.targetConfig && !args.docsOnly && !liveRunnerSelected(args)) {
    throw new Error('--target-config declares the configuration of the live runners\' target; select a live runner '
      + '(--iq, --oq, --pq, --security, --dr, --perf or --all).');
  }
  // The TA3 plan and the suite selection are the OQ runner's own options; a documents run reads neither.
  if (!args.docsOnly && (args.ta3OqPlan || args.oqSuites) && !args.runOq) {
    throw new Error(`${args.ta3OqPlan ? '--ta3-oq-plan' : '--oq-suites'} is an option of the OQ runner; select --oq or --all.`);
  }
  // The TA3 suites write owned records into the study the plan names, like the owned fixture: synthetic qualification only.
  if (!args.docsOnly && args.ta3OqPlan && !args.qualificationFlags.includes('--synthetic-qualification')) {
    throw new Error('--ta3-oq-plan runs the TA3 OQ suites, which write owned synthetic records into the study the plan names; pass --synthetic-qualification.');
  }
  if (!args.docsOnly && liveRunnerSelected(args)) {
    // Executed live-runner evidence goes to a retained, sealed package, or is
    // stated not to be validation evidence; never to unmarked scratch.
    if (!args.retainRoot && !args.noRetain) {
      throw new Error('Live runners require --retain-root <directory> (a retained, sealed evidence package) or --no-retain '
        + `(${DEVELOPMENT_RUN_NOTICE}).`);
    }
    checkRunnerTarget(args);
    args.releaseIdentity = releaseIdentityFromInputs(args.releaseInputs);
    // The training gate decides every clinical save the TA3 suites make (spec P20 3.10).
    if (args.runOq && args.ta3OqPlan && (args.oqSuites ?? ALL_OQ_SUITES).ta3.length) requireTrainingRelease(args.releaseIdentity, 'OQ suites 13 to 18');
  } else if (Object.keys(args.releaseInputs).length) {
    args.releaseIdentity = releaseIdentityFromInputs(args.releaseInputs);
  }
  return args;
}

function liveRunnerSelected(args: CliArgs): boolean {
  return args.runIq || args.runOq || args.runPq || args.runSecurity || args.runDr || args.runPerf;
}

/** Owner domains whose hosts are production unless the system information
 * lists them as a staging host. */
const OWNER_DOMAINS = ['accuratrials.com', 'acuratrials.com'];

function isProductionHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const hostOf = (url: string) => new URL(url).hostname.toLowerCase();
  const { production, staging } = SYSTEM_INFO.environments;
  if ([production.apiUrl, production.frontendUrl].map(hostOf).includes(host)) return true;
  if ([staging.apiUrl, staging.frontendUrl].map(hostOf).includes(host)) return false;
  return OWNER_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

/** Live runners write and read through the target. There is no default target,
 * and the production host is refused unless the operator passes the documented
 * --allow-production-target flag. */
function checkRunnerTarget(args: CliArgs): void {
  if (!args.baseUrl) {
    throw new Error('Live runners require an explicit --base-url (for example http://localhost:3000). There is no default target.');
  }
  let target: URL;
  try { target = new URL(args.baseUrl); }
  catch { throw new Error(`--base-url is not a valid URL: ${args.baseUrl}`); }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`--base-url must use http or https: ${args.baseUrl}`);
  }
  if (isProductionHost(target.hostname) && !args.allowProductionTarget) {
    throw new Error(`Refusing production host ${target.hostname}. Pass --allow-production-target only for an approved production run.`);
  }
}

interface GeneratorEntry {
  name: string;
  file: string;
}

const GENERATORS: GeneratorEntry[] = [
  { name: 'applicability-assessment', file: './generators/01-applicability-assessment' },
  { name: 'validation-plan', file: './generators/02-validation-plan' },
  { name: 'user-requirements-spec', file: './generators/03-user-requirements-spec' },
  { name: 'functional-requirements-spec', file: './generators/04-functional-requirements-spec' },
  { name: 'risk-assessment', file: './generators/05-risk-assessment' },
  { name: 'traceability-matrix', file: './generators/06-traceability-matrix' },
  { name: 'iq-protocol', file: './generators/07-iq-protocol' },
  { name: 'oq-protocol', file: './generators/08-oq-protocol' },
  { name: 'pq-protocol', file: './generators/09-pq-protocol' },
  { name: 'deviation-log', file: './generators/10-deviation-log' },
  { name: 'capa-records', file: './generators/11-capa-records' },
  { name: 'validation-summary', file: './generators/12-validation-summary' },
  { name: 'sop-gap-analysis', file: './generators/13-sop-gap-analysis' },
  { name: 'hipaa-assessment', file: './generators/14-hipaa-assessment' },
  { name: 'training-matrix', file: './generators/15-training-matrix' },
  { name: 'release-gate-checklist', file: './generators/16-release-gate-checklist' },
  { name: 'fda-supplemental', file: './generators/17-fda-supplemental' },
  { name: 'regulatory-requirements-map', file: './generators/18-regulatory-requirements-map' },
  { name: 'csa-feature-assurance', file: './generators/19-csa-feature-assurance' },
  { name: 'test-execution-records', file: './generators/20-test-execution-records' },
  { name: 'design-specification', file: './generators/21-design-specification' },
  { name: 'platform-validation-summary', file: './generators/22-platform-validation-summary' },
];

interface CollectorEntry {
  name: string;
  file: string;
}

function failedRunnerCases(results: unknown): string[] {
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('Selected runner returned no test evidence.');
  }
  const failed: string[] = [];
  for (const result of results) {
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || typeof result.testCaseId !== 'string' || !result.testCaseId.trim()
      || typeof result.passed !== 'boolean') {
      throw new Error('Selected runner returned malformed test evidence.');
    }
    if (!result.passed) failed.push(result.testCaseId);
  }
  return failed;
}

const COLLECTORS: CollectorEntry[] = [
  { name: 'routes', file: './collectors/route-collector' },
  { name: 'middleware', file: './collectors/middleware-collector' },
  { name: 'services', file: './collectors/service-collector' },
  { name: 'interop', file: './collectors/interop-collector' },
  { name: 'frontend', file: './collectors/frontend-collector' },
  { name: 'tests', file: './collectors/test-collector' },
  { name: 'migrations', file: './collectors/migration-collector' },
  { name: 'sops', file: './collectors/sop-collector' },
  { name: 'shared-types', file: './collectors/shared-types-collector' },
];

function createLatestPointer(outputDir: string): void {
  const latestPath = path.join(__dirname, 'output', 'latest');
  try {
    if (fs.existsSync(latestPath)) {
      const stat = fs.lstatSync(latestPath);
      if (stat.isSymbolicLink() || stat.isFile()) {
        fs.unlinkSync(latestPath);
      }
    }
  } catch { /* ignore cleanup errors */ }

  if (process.platform === 'win32') {
    fs.writeFileSync(latestPath, outputDir, 'utf-8');
  } else {
    try {
      fs.symlinkSync(outputDir, latestPath, 'dir');
    } catch {
      fs.writeFileSync(latestPath, outputDir, 'utf-8');
    }
  }
}

/** Where a run's output goes (spec P20 VD-3): a retained package sealed at the
 * end; output/ scratch marked as a development run (--no-retain, or an evidence
 * import given neither flag); or plain output/ scratch for documents. */
type Retention =
  | { kind: 'package'; evidencePackage: EvidencePackage }
  | { kind: 'not-retained' }
  | { kind: 'scratch' };

/** The plan files and captures a package copies into inputs/, with their hashes. */
function packageInputs(args: CliArgs): PackageInputSource[] {
  const inputs: PackageInputSource[] = [];
  if (args.trainingEvidence) inputs.push({ role: 'training-evidence', file: args.trainingEvidence });
  if (!args.docsOnly && args.p13Plan) inputs.push({ role: 'p13-plan', file: args.p13Plan });
  if (!args.docsOnly && args.benchmarkRun) inputs.push(...benchmarkRunInputs(args.benchmarkRun));
  if (!args.docsOnly && args.targetConfig) inputs.push({ role: 'target-configuration', file: args.targetConfig });
  if (!args.docsOnly && args.ta3OqPlan) inputs.push({ role: 'ta3-oq-plan', file: args.ta3OqPlan });
  // The platform summary is a document, so its plan is read in every mode, documents runs included.
  if (args.platformEvidence) inputs.push({ role: 'platform-evidence-plan', file: args.platformEvidence });
  return inputs;
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args.docsOnly && args.targetConfig) {
    // Refused before anything runs: a declaration that breaks its contract or describes another target.
    const declared = checkTargetConfiguration(args.targetConfig, args.baseUrl as string);
    console.log(`Configuration under test: ${declared.file} (${declared.configuration.contract}, SHA-256 ${declared.sha256.slice(0, 12)})`);
  }
  if (!args.docsOnly && args.ta3OqPlan) {
    // Refused before anything runs: a plan that breaks its contract.
    const loaded = checkTa3OqPlan(args.ta3OqPlan);
    console.log(`TA3 OQ plan: ${loaded.file} (${loaded.plan.contract}, study ${loaded.plan.study.studyId}, OQ site ${loaded.plan.study.siteStudyId}, SHA-256 ${loaded.sha256.slice(0, 12)})`);
  }
  let platformEvidenceSynthetic = false;
  if (args.platformEvidence) {
    // Refused before anything runs: a plan that breaks its contract, cites what the inventory does not admit,
    // or declares a cited package's synthetic flag wrongly. Hashes that do not match are shown in document 22.
    const checked = checkPlatformEvidencePlan(args.platformEvidence);
    platformEvidenceSynthetic = checked.synthetic;
    const counts = PLATFORM_EVIDENCE_STATUSES.map(status => `${checked.entries.filter(entry => entry.status === status).length} ${status}`);
    console.log(`Platform evidence plan: ${checked.file} (${checked.plan.contract}, ${counts.join(', ')}`
      + `${checked.synthetic ? ', cites synthetic evidence' : ''}, SHA-256 ${checked.sha256.slice(0, 12)})`);
  }
  const version = args.version || 'v1.0';
  const imports = !args.docsOnly && Boolean(args.benchmarkRun || args.p13Plan);
  const executed = imports || (!args.docsOnly && liveRunnerSelected(args));
  // Synthetic is computed from the run, never chosen; every import is synthetic engineering evidence, and a
  // documents package whose platform evidence plan cites synthetic evidence is synthetic too (VD-3).
  const basis = syntheticBasis({
    syntheticQualification: args.qualificationFlags.includes('--synthetic-qualification'),
    benchmarkImport: !args.docsOnly && Boolean(args.benchmarkRun),
    p13Import: !args.docsOnly && Boolean(args.p13Plan),
    platformEvidencePlan: platformEvidenceSynthetic,
  });
  if (args.retainRoot) {
    // Refused before anything runs when the root, a marker or an input is wrong.
    const evidencePackage = createPackage({ retainRoot: args.retainRoot, version, executed, syntheticBasis: basis, inputs: packageInputs(args) });
    try {
      await generateInto(args, evidencePackage.dir, { kind: 'package', evidencePackage });
    } finally {
      // Sealed whatever the outcome, so a failed run is retained too.
      sealRetainedPackage(evidencePackage, args);
    }
    return;
  }
  const date = new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, 'output', `${date}_${version}`);
  // Scratch that summarises synthetic evidence says so, and that it is not retained (D-22).
  if (args.noRetain || executed || platformEvidenceSynthetic) {
    markDevelopmentRun(basis.length > 0);
    await generateInto(args, outputDir, { kind: 'not-retained' });
  } else {
    await generateInto(args, outputDir, { kind: 'scratch' });
  }
}

function sealRetainedPackage(evidencePackage: EvidencePackage, args: CliArgs): void {
  try {
    const sealed = sealPackage(evidencePackage, { baseUrl: !args.docsOnly && liveRunnerSelected(args) ? args.baseUrl : undefined });
    console.log('=== Retained Evidence Package ===');
    console.log(`  Package:      ${sealed.dir}`);
    console.log(`  Files:        ${sealed.files}, read-only, listed in ${path.basename(sealed.manifestPath)}`);
    console.log(`  Package hash: ${sealed.packageHash}`);
    console.log(`  package-manifest.json SHA-256: ${sealed.manifestSha256}`);
    console.log('  File it in the eTMF as its TMF-FILING.md describes; npm run verify:package rechecks it.');
    console.log('');
  } catch (error) {
    console.error(`  [FAIL] Evidence package not sealed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function generateInto(args: CliArgs, outputDir: string, retention: Retention): Promise<void> {
  // Documents and evidence of this run carry the release under test.
  setReleaseIdentity(args.releaseIdentity);

  fs.mkdirSync(path.join(outputDir, 'evidence', 'iq'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'evidence', 'oq'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'evidence', 'pq'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'evidence', 'security'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'evidence', 'dr'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'evidence', 'performance'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'evidence', 'security'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'evidence', 'dr'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'evidence', 'performance'), { recursive: true });

  console.log('');
  console.log('=== AccuraTrial EDC Validation Framework ===');
  console.log(`Output: ${outputDir}`);
  console.log(`Workspace: ${WORKSPACE_ROOT}`);
  console.log(`Mode: ${args.docsOnly ? 'Documents only' : args.only ? `Single: ${args.only}` : 'Full'}`);
  if (!args.docsOnly && (args.runIq || args.runOq || args.runPq)) {
    console.log(`Runners: ${[args.runIq && 'IQ', args.runOq && 'OQ', args.runPq && 'PQ', args.runSecurity && 'Security', args.runDr && 'DR', args.runPerf && 'Performance'].filter(Boolean).join(', ')}`);
    console.log(`Base URL: ${args.baseUrl}`);
  }
  if (args.releaseIdentity) {
    console.log(`Release under test: ${releaseSummary(args.releaseIdentity)} (${args.releaseIdentity.identityHash.slice(0, 12)})`);
  }
  if (retention.kind === 'package') {
    console.log(`Retention: sealed evidence package${retention.evidencePackage.synthetic ? ' (synthetic engineering evidence)' : ''}`);
  } else if (retention.kind === 'not-retained') {
    console.log(`Retention: none. ${DEVELOPMENT_RUN_NOTICE}; nothing from this run is retained.`);
  }
  console.log('');

  // Phase 1: Run collectors
  console.log('--- Collectors ---');
  let collectorsFailed = 0;
  for (const collector of COLLECTORS) {
    try {
      require(collector.file);
      console.log(`  [OK] ${collector.name}`);
    } catch (err) {
      collectorsFailed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [FAIL] ${collector.name}: ${message}`);
    }
  }
  console.log('');

  // The training matrix is generated from the training module's own capture.
  if (args.trainingEvidence) {
    const { retainTrainingInspectionEvidence } = require('./generators/15-training-matrix') as typeof import('./generators/15-training-matrix');
    console.log(`Training evidence retained: ${retainTrainingInspectionEvidence(args.trainingEvidence, outputDir)}`);
  }

  // IQ-033, the TA3 suites and the platform summary read the inputs a package retained, so they check the bytes the manifest lists.
  const retained = retention.kind === 'package' ? retention.evidencePackage : undefined;
  const retainedInput = (role: PackageInputSource['role'], given?: string): string | undefined => {
    const input = retained?.inputs.find(entry => entry.role === role);
    return retained && input ? path.join(retained.dir, ...input.path.split('/')) : given;
  };
  // Generator-specific options go only to the generator that takes them: the platform summary's plan and root.
  const platformEvidencePlan = retainedInput('platform-evidence-plan', args.platformEvidence);
  const generatorOptions: Record<string, Record<string, unknown> | undefined> = {
    'platform-validation-summary': platformEvidencePlan || args.platformRoot
      ? { ...(platformEvidencePlan ? { platformEvidencePlan } : {}), ...(args.platformRoot ? { platformRoot: args.platformRoot } : {}) }
      : undefined,
  };
  const runGenerator = (gen: GeneratorEntry) => {
    const mod = require(gen.file) as { generate: (outputDir: string, workspaceRoot: string, options?: Record<string, unknown>) => void };
    const options = generatorOptions[gen.name];
    if (options) mod.generate(outputDir, WORKSPACE_ROOT, options);
    else mod.generate(outputDir, WORKSPACE_ROOT);
  };

  // Phase 2: Run generators
  console.log('--- Generators ---');
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let runnersPassed = 0;
  let runnersFailed = 0;

  for (const gen of GENERATORS) {
    if (args.only && gen.name !== args.only) {
      skipped++;
      continue;
    }

    try {
      runGenerator(gen);
      console.log(`  [OK] ${gen.name}`);
      generated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [FAIL] ${gen.name}: ${message}`);
      failed++;
    }
  }

  console.log('');

  // Phase 3: Run test runners if requested
  if (!args.docsOnly && (args.p13Plan || args.benchmarkRun || args.runIq || args.runOq || args.runPq || args.runSecurity || args.runDr || args.runPerf)) {
    console.log('--- Test Runners ---');

    if (args.benchmarkRun) {
      try {
        const { importBenchmarkEvidence } = require('./runners/benchmark-evidence') as typeof import('./runners/benchmark-evidence');
        const results = await importBenchmarkEvidence(outputDir, {
          runDir: args.benchmarkRun, evaluatorRoot: args.benchmarkEvaluatorRoot,
        });
        const notPassed = failedRunnerCases(results);
        if (notPassed.length) {
          runnersFailed++;
          // An O-7 import always lists PQT-006: the answer key's adjudication is a person's act, never passed here.
          console.error(`  [FAIL] Benchmark reconstruction, engineering gates or PQ cases not passed (${notPassed.join(', ')}); see retained benchmark evidence.`);
        } else {
          runnersPassed++;
          console.log('  [OK] Benchmark reconstructed; synthetic engineering scope only.');
        }
      } catch (error) {
        runnersFailed++;
        console.error(`  [FAIL] Benchmark evidence: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (args.p13Plan) {
      try {
        const { importP13BenchmarkEvidence } = require('./runners/benchmark-evidence') as typeof import('./runners/benchmark-evidence');
        const results = await importP13BenchmarkEvidence(outputDir, { planFile: args.p13Plan,
          allowProductionQualification: args.qualificationFlags.includes('--allow-production-qualification') });
        if (failedRunnerCases(results).length) {
          runnersFailed++;
          console.error('  [FAIL] P13 attachment or native metrics incomplete/failed; see retained P13 evidence.');
        } else {
          runnersPassed++;
          console.log('  [OK] P13 native evidence attached; engineering scope only.');
        }
      } catch (error) {
        runnersFailed++;
        console.error(`  [FAIL] P13 evidence: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let releaseVerified = true;
    if (liveRunnerSelected(args) && args.releaseIdentity) {
      try {
        const observed = await observeTargetVersion(args.releaseIdentity, args.baseUrl as string);
        setReleaseIdentity(observed);
        const target = observed.target!;
        console.log(target.error
          ? `  [WARN] Target version endpoint unavailable (${target.error}); release identity is operator input only.`
          : `  [OK] Target reports version ${target.version ?? 'none'}${target.release ? ' and its release components' : ''}.`);
      } catch (error) {
        releaseVerified = false;
        runnersFailed++;
        console.error(`  [FAIL] Release identity: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const targetConfigFile = retainedInput('target-configuration', args.targetConfig);
    const ta3PlanFile = retainedInput('ta3-oq-plan', args.ta3OqPlan);
    // The OQ runner's options: the TA3 plan, the suite selection and, for the TA3 suites, the declaration.
    const oqOptions = ta3PlanFile || args.oqSuites
      ? { ...(ta3PlanFile ? { ta3PlanFile } : {}), ...(args.oqSuites ? { suites: args.oqSuites } : {}), ...(ta3PlanFile && targetConfigFile ? { targetConfigFile } : {}) }
      : undefined;
    const runners: { flag: boolean; name: string; file: string; options?: Record<string, unknown> }[] = [
      { flag: args.runIq, name: 'IQ Runner', file: './runners/iq-runner', options: targetConfigFile ? { targetConfigFile } : undefined },
      { flag: args.runOq, name: 'OQ Runner', file: './runners/oq-runner', options: oqOptions },
      { flag: args.runSecurity || args.runOq, name: 'Security Runner', file: './runners/security-runner' },
      { flag: args.runPq, name: 'PQ Runner', file: './runners/pq-runner' },
      { flag: args.runDr || args.runPq, name: 'DR Runner', file: './runners/dr-runner' },
      { flag: args.runPerf || args.runPq, name: 'Performance Runner', file: './runners/performance-runner' },
    ];

    for (const runner of runners) {
      if (!runner.flag || !releaseVerified) continue;
      try {
        const mod = require(runner.file) as {
          run: (outputDir: string, baseUrl: string, workspaceRoot: string, qualificationFlags: readonly string[], options?: Record<string, unknown>) => Promise<EvidenceResult[]>;
        };
        // Runner-specific options go only to the runner that takes them.
        const results = runner.options
          ? await mod.run(outputDir, args.baseUrl as string, WORKSPACE_ROOT, args.qualificationFlags, runner.options)
          : await mod.run(outputDir, args.baseUrl as string, WORKSPACE_ROOT, args.qualificationFlags);
        const failedCases = failedRunnerCases(results);
        if (failedCases.length > 0) {
          runnersFailed++;
          console.error(`  [FAIL] ${runner.name}: ${failedCases.length}/${results.length} cases failed or remain unexecuted (${failedCases.join(', ')}).`);
        } else {
          runnersPassed++;
          console.log(`  [OK] ${runner.name}: ${results.length} cases passed`);
        }
      } catch (err) {
        runnersFailed++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  [FAIL] ${runner.name}: ${message}`);
      }
    }

    console.log('');

    // Re-run summary and gate checklist to incorporate evidence
    console.log('--- Re-generating evidence-dependent documents ---');
    // The regulatory map reads the retained cases too (its Part 11, HIPAA, ICH E6(R3) and TA3 use verification).
    // The IQ, OQ and PQ protocols name the target the release identity observed, which is set only after phase 2 (RF-009).
    const evidenceDependentGens = GENERATORS.filter(
      (g) => g.name === 'traceability-matrix' || g.name === 'validation-summary' || g.name === 'release-gate-checklist' || g.name === 'csa-feature-assurance' || g.name === 'test-execution-records'
        || g.name === 'platform-validation-summary' || g.name === 'regulatory-requirements-map'
        || g.name === 'iq-protocol' || g.name === 'oq-protocol' || g.name === 'pq-protocol'
    );
    for (const gen of evidenceDependentGens) {
      try {
        delete require.cache[require.resolve(gen.file)];
        runGenerator(gen);
        console.log(`  [OK] ${gen.name} (refreshed)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  [FAIL] ${gen.name}: ${message}`);
        failed++;
      }
    }

    console.log('');

    generateMasterEvidenceIndex(outputDir);
  }

  // Phase 4: Create latest pointer (scratch only; a package is found by its own path)
  if (retention.kind !== 'package') createLatestPointer(outputDir);

  // Phase 5: Print summary
  console.log('=== Summary ===');
  console.log(`  Generated: ${generated}`);
  if (skipped > 0) {
    console.log(`  Skipped:   ${skipped}`);
  }
  if (failed > 0) {
    console.log(`  Failed:    ${failed}`);
  }
  if (runnersPassed + runnersFailed > 0) {
    console.log(`  Runners:   ${runnersPassed} passed, ${runnersFailed} failed`);
  }
  if (collectorsFailed > 0) {
    console.log(`  Collectors failed: ${collectorsFailed}`);
  }
  console.log(`  Output:    ${outputDir}`);
  console.log('');

  const outputFiles = fs.readdirSync(outputDir).filter((f) => f.endsWith('.md')).sort();
  if (outputFiles.length > 0) {
    console.log('  Generated files:');
    for (const file of outputFiles) {
      console.log(`    - ${file}`);
    }
    console.log('');
  }

  if (failed > 0 || runnersFailed > 0 || collectorsFailed > 0) {
    console.log(`  WARNING: ${collectorsFailed} collector(s), ${failed} document generation operation(s) and ${runnersFailed} runner(s) failed. Review errors and retained evidence above.`);
    process.exitCode = 1;
  } else {
    console.log('  All generators completed successfully.');
  }
}

function generateMasterEvidenceIndex(outputDir: string): void {
  const evidenceBase = path.join(outputDir, 'evidence');
  if (!fs.existsSync(evidenceBase)) return;

  const categories = ['iq', 'oq', 'pq', 'security', 'dr', 'performance', 'benchmark', 'p13'];
  const lines: string[] = [
    // The run's notices, the metadata and the ICH E6(R3) status row every document carries (RF-010).
    ...masterEvidenceIndexHeader(new Date().toISOString()),
    '## Evidence Summary',
    '',
    // Total to Pass Rate count every row; Registry Cases counts the protocol cases apart from bookkeeping rows (IR-416).
    '| Category | Total | Passed | Failed | Manual | Pass Rate | Registry Cases | Report |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  let grandTotal = 0;
  let grandPassed = 0;
  let grandFailed = 0;

  for (const cat of categories) {
    const summaryPath = path.join(evidenceBase, cat, `${cat}-summary.json`);
    if (!fs.existsSync(summaryPath)) continue;
    try {
      const raw = fs.readFileSync(summaryPath, 'utf-8');
      const summary = JSON.parse(raw) as Record<string, unknown>;
      const total = (summary.total as number) || 0;
      const passed = (summary.passed as number) || 0;
      const failed = (summary.failed as number) || 0;
      const manual = (summary.manual as number) || 0;
      const rate = summary.passRate as string || 'N/A';
      const rows = Array.isArray(summary.results)
        ? (summary.results as unknown[]).filter((row): row is { testCaseId: string; passed: boolean } =>
          typeof row === 'object' && row !== null && typeof (row as Record<string, unknown>).testCaseId === 'string'
          && typeof (row as Record<string, unknown>).passed === 'boolean')
        : [];
      grandTotal += total;
      grandPassed += passed;
      grandFailed += failed;
      lines.push(`| ${cat.toUpperCase()} | ${total} | ${passed} | ${failed} | ${manual} | ${rate} | ${registryCasesText(rows)} | evidence/${cat}/${cat}-execution-report.md |`);
    } catch { /* skip */ }
  }

  const grandRate = grandTotal > 0 ? `${((grandPassed / grandTotal) * 100).toFixed(1)}%` : 'N/A';
  lines.push(`| **TOTAL** | **${grandTotal}** | **${grandPassed}** | **${grandFailed}** | — | **${grandRate}** | — | — |`);
  lines.push('');
  lines.push('## Release Under Test');
  lines.push('');
  lines.push('| Category | Release Identity | API | UI | Core | Training |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  const identities = new Set<string>();
  for (const cat of categories) {
    const identityPath = path.join(evidenceBase, cat, 'release-identity.json');
    if (!fs.existsSync(path.join(evidenceBase, cat, `${cat}-summary.json`))) continue;
    if (!fs.existsSync(identityPath)) {
      lines.push(`| ${cat.toUpperCase()} | not recorded | | | | |`);
      continue;
    }
    try {
      // Version 1 or 2; a version 1 identity's training cell reads "not recorded".
      const identity = JSON.parse(fs.readFileSync(identityPath, 'utf-8')) as ReleaseIdentity;
      identities.add(identity.identityHash);
      lines.push(`| ${cat.toUpperCase()} | ${releaseIndexCells(identity).join(' | ')} |`);
    } catch {
      lines.push(`| ${cat.toUpperCase()} | unreadable | | | | |`);
    }
  }
  if (identities.size > 1) {
    lines.push('');
    lines.push('**The categories above were produced against different releases; they do not qualify one release together.**');
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Individual Evidence Files');
  lines.push('');

  for (const cat of categories) {
    const catDir = path.join(evidenceBase, cat);
    if (!fs.existsSync(catDir)) continue;
    lines.push(`### ${cat.toUpperCase()}`);
    lines.push('');
    const files = fs.readdirSync(catDir).filter(f => f.endsWith('.json')).sort();
    for (const file of files) {
      lines.push(`- evidence/${cat}/${file}`);
    }
    const mdReport = `${cat}-execution-report.md`;
    if (fs.existsSync(path.join(catDir, mdReport))) {
      lines.push(`- evidence/${cat}/${mdReport} (Human-readable execution report)`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(approvalBlock(['QA Lead', 'Validation Lead']));
  lines.push('---');
  lines.push('*End of Document*');

  fs.writeFileSync(
    path.join(outputDir, 'evidence', 'MASTER-EVIDENCE-INDEX.md'),
    lines.join('\n'),
    'utf-8',
  );

  console.log('  [OK] Master evidence index generated');
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
