import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isRecord, saveEvidence, type EvidenceResult } from './evidence-capture';

export interface BenchmarkEvidenceOptions {
  runDir: string;
  /** Canonical CommandCenter checkout; historical evaluators use evaluatorRoot. */
  commandCenterRoot?: string;
  evaluatorRoot?: string;
}

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const SCOPE = 'Synthetic engineering evidence only. Reconstruction verifies retained results; it does not establish independent clinical validation, SURPASS attainment, or IL extraction performance.';

/** Reuse the authoritative evaluator, including its byte-for-byte re-score.
 * Never accept a submitted summary or an externally supplied "ok" flag alone.
 * This is offline: it does not execute products, models, or live clinical APIs.
 */
export async function importBenchmarkEvidence(outputDir: string, options: BenchmarkEvidenceOptions): Promise<EvidenceResult[]> {
  const runDir = path.resolve(options.runDir);
  const root = path.resolve(options.commandCenterRoot ?? path.join(__dirname, '..', '..', '..', 'CommandCenter'));
  const script = path.join(root, 'synthetic-trial', 'evaluate', 'reconstruct.mjs');
  const timestamp = new Date().toISOString();
  const makeResult = (testCaseId: string, passed: boolean, responseBody: unknown, notes: string): EvidenceResult => ({
    testCaseId, timestamp, endpoint: runDir, method: 'OFFLINE', responseStatus: 0,
    responseBody, passed, notes: `${notes} ${SCOPE}`,
    testDescription: testCaseId === 'BENCHMARK-RECONSTRUCTION' ? 'Reconstruct frozen benchmark evidence' : 'Retained local engineering gate result',
    acceptanceCriteria: testCaseId === 'BENCHMARK-RECONSTRUCTION'
      ? 'All retained inputs, metrics, gates and outputs reconstruct with the recorded evaluator.'
      : 'Reconstruction succeeds and the authoritative localEngineering gate is passed.',
  });
  let results: EvidenceResult[];
  try {
    const summaryPath = path.join(runDir, 'run-summary.json');
    const metricsPath = path.join(runDir, 'metrics.json');
    const beforeSummary = fs.readFileSync(summaryPath);
    const beforeMetrics = fs.readFileSync(metricsPath);
    const args = [script, '--dir', runDir];
    if (options.evaluatorRoot) args.push('--evaluator-root', path.resolve(options.evaluatorRoot));
    const execution = spawnSync(process.execPath, args, {
      cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
      windowsHide: true, shell: false,
    });
    if (execution.error) throw execution.error;
    if (execution.status !== 0 || execution.signal) {
      // Retain the diagnostic in the protected qualification package, not stdout.
      throw new Error(`Benchmark reconstruction failed: ${execution.stderr.trim() || execution.signal || execution.status}`);
    }
    const reconstruction: unknown = JSON.parse(execution.stdout);
    if (!isRecord(reconstruction) || reconstruction.ok !== true || reconstruction.rescored !== 'compared') {
      throw new Error('Benchmark reconstruction did not complete a byte-for-byte re-score.');
    }
    if (!beforeSummary.equals(fs.readFileSync(summaryPath)) || !beforeMetrics.equals(fs.readFileSync(metricsPath))) {
      throw new Error('Benchmark outputs changed during reconstruction.');
    }
    const summary: unknown = JSON.parse(beforeSummary.toString('utf8'));
    if (!isRecord(summary) || !isRecord(summary.evaluator) || !Array.isArray(summary.gateGroups)
      || !['passed', 'failed', 'blocked', 'not_run'].includes(String(summary.localEngineering))) {
      throw new Error('Unsupported benchmark summary contract.');
    }
    const attachment = {
      contract: 'accura-benchmark-qualification/1', evidenceLevel: 'synthetic_engineering',
      independentlyValidated: false, runDir, evaluator: summary.evaluator,
      summarySha256: hash(beforeSummary), metricsSha256: hash(beforeMetrics),
      reconstruction, localEngineering: summary.localEngineering,
      gateGroups: summary.gateGroups, reEvaluation: summary.reEvaluation ?? null,
      // Original records remain authoritative. Do not copy sealed case-level gold.
      artifacts: { summary: summaryPath, metrics: metricsPath },
    };
    results = [
      makeResult('BENCHMARK-RECONSTRUCTION', true, attachment, 'Retained results reconstructed.'),
      makeResult('BENCHMARK-ENGINEERING-GATES', summary.localEngineering === 'passed', attachment,
        `Local engineering status: ${summary.localEngineering}. Other gate groups retain their original status.`),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results = [makeResult('BENCHMARK-RECONSTRUCTION', false,
      { contract: 'accura-benchmark-qualification/1', evidenceLevel: 'synthetic_engineering', independentlyValidated: false, error: message },
      'Benchmark evidence could not be reconstructed; no performance claim is admitted.'),
    makeResult('BENCHMARK-ENGINEERING-GATES', false, { status: 'not_run' }, 'Gate result unavailable without successful reconstruction.')];
  }
  const target = path.join(outputDir, 'evidence', 'benchmark');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    // Atomically reserve the category: simultaneous imports cannot overwrite it.
    fs.mkdirSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Benchmark evidence already exists; use a new qualification output directory.');
    }
    throw error;
  }
  saveEvidence(outputDir, 'benchmark', results);
  return results;
}
