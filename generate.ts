import * as fs from 'fs';
import * as path from 'path';

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
  baseUrl: string;
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
    baseUrl: 'https://api.accuratrials.com',
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
      case '--base-url':
        i++;
        args.baseUrl = argv[i];
        break;
      default:
        console.warn(`  [WARN] Unknown argument: ${arg}`);
    }
  }

  return args;
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
];

interface CollectorEntry {
  name: string;
  file: string;
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

async function main(): Promise<void> {
  const args = parseArgs();
  const date = new Date().toISOString().split('T')[0];
  const version = args.version || 'v1.0';
  const outputDir = path.join(__dirname, 'output', `${date}_${version}`);

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
  console.log('');

  // Phase 1: Run collectors
  console.log('--- Collectors ---');
  for (const collector of COLLECTORS) {
    try {
      require(collector.file);
      console.log(`  [OK] ${collector.name}`);
    } catch {
      console.log(`  [SKIP] ${collector.name} (not available)`);
    }
  }
  console.log('');

  // Phase 2: Run generators
  console.log('--- Generators ---');
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const gen of GENERATORS) {
    if (args.only && gen.name !== args.only) {
      skipped++;
      continue;
    }

    try {
      const mod = require(gen.file) as { generate: (outputDir: string, workspaceRoot: string) => void };
      mod.generate(outputDir, WORKSPACE_ROOT);
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
  if (!args.docsOnly && (args.runIq || args.runOq || args.runPq || args.runSecurity || args.runDr || args.runPerf)) {
    console.log('--- Test Runners ---');

    const runners: { flag: boolean; name: string; file: string }[] = [
      { flag: args.runIq, name: 'IQ Runner', file: './runners/iq-runner' },
      { flag: args.runOq, name: 'OQ Runner', file: './runners/oq-runner' },
      { flag: args.runSecurity || args.runOq, name: 'Security Runner', file: './runners/security-runner' },
      { flag: args.runPq, name: 'PQ Runner', file: './runners/pq-runner' },
      { flag: args.runDr || args.runPq, name: 'DR Runner', file: './runners/dr-runner' },
      { flag: args.runPerf || args.runPq, name: 'Performance Runner', file: './runners/performance-runner' },
    ];

    for (const runner of runners) {
      if (!runner.flag) continue;
      try {
        const mod = require(runner.file) as { run: (outputDir: string, baseUrl: string) => Promise<void> };
        await mod.run(outputDir, args.baseUrl);
        console.log(`  [OK] ${runner.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  [FAIL] ${runner.name}: ${message}`);
      }
    }

    console.log('');

    // Re-run summary and gate checklist to incorporate evidence
    console.log('--- Re-generating evidence-dependent documents ---');
    const evidenceDependentGens = GENERATORS.filter(
      (g) => g.name === 'traceability-matrix' || g.name === 'validation-summary' || g.name === 'release-gate-checklist' || g.name === 'csa-feature-assurance' || g.name === 'test-execution-records'
    );
    for (const gen of evidenceDependentGens) {
      try {
        delete require.cache[require.resolve(gen.file)];
        const mod = require(gen.file) as { generate: (outputDir: string, workspaceRoot: string) => void };
        mod.generate(outputDir, WORKSPACE_ROOT);
        console.log(`  [OK] ${gen.name} (refreshed)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  [FAIL] ${gen.name}: ${message}`);
      }
    }

    console.log('');

    generateMasterEvidenceIndex(outputDir);
  }

  // Phase 4: Create latest pointer
  createLatestPointer(outputDir);

  // Phase 5: Print summary
  console.log('=== Summary ===');
  console.log(`  Generated: ${generated}`);
  if (skipped > 0) {
    console.log(`  Skipped:   ${skipped}`);
  }
  if (failed > 0) {
    console.log(`  Failed:    ${failed}`);
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

  if (failed > 0) {
    console.log(`  WARNING: ${failed} generator(s) failed. Review errors above.`);
    process.exitCode = 1;
  } else {
    console.log('  All generators completed successfully.');
  }
}

function generateMasterEvidenceIndex(outputDir: string): void {
  const evidenceBase = path.join(outputDir, 'evidence');
  if (!fs.existsSync(evidenceBase)) return;

  const categories = ['iq', 'oq', 'pq', 'security', 'dr', 'performance'];
  const lines: string[] = [
    '# Master Test Execution Evidence Index',
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Generated | ${new Date().toISOString()} |`,
    `| System | AccuraTrial Electronic Data Capture System |`,
    `| Classification | Confidential — Regulatory |`,
    '',
    '---',
    '',
    '## Evidence Summary',
    '',
    '| Category | Total | Passed | Failed | Manual | Pass Rate | Report |',
    '| --- | --- | --- | --- | --- | --- | --- |',
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
      grandTotal += total;
      grandPassed += passed;
      grandFailed += failed;
      lines.push(`| ${cat.toUpperCase()} | ${total} | ${passed} | ${failed} | ${manual} | ${rate} | evidence/${cat}/${cat}-execution-report.md |`);
    } catch { /* skip */ }
  }

  const grandRate = grandTotal > 0 ? `${((grandPassed / grandTotal) * 100).toFixed(1)}%` : 'N/A';
  lines.push(`| **TOTAL** | **${grandTotal}** | **${grandPassed}** | **${grandFailed}** | — | **${grandRate}** | — |`);
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
  lines.push('## Approval Signatures');
  lines.push('');
  lines.push('| Role | Name | Signature | Date |');
  lines.push('|------|------|-----------|------|');
  lines.push('| QA Lead | _________________ | _________________ | ____/____/____ |');
  lines.push('| Validation Lead | _________________ | _________________ | ____/____/____ |');
  lines.push('');
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
