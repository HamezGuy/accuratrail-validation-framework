import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { importBenchmarkEvidence } from '../runners/benchmark-evidence';
import { loadEvidence } from '../runners/evidence-capture';
import { loadRunnerEvidence } from '../generators/helpers/evidence-linker';
import { generate } from '../generators/20-test-execution-records';

const cc = path.resolve(__dirname, '..', '..', '..', 'CommandCenter');
function workspace(t: { after(fn: () => void): void }) {
  const base = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(base, 'accura-benchmark-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), base);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function fixture(dir: string) {
  const runDir = path.join(dir, 'run');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'fixtures', 'benchmark-offline.mjs'), cc, runDir], {
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return runDir;
}

test('real retained scoring evidence reconstructs and preserves blocked engineering gates', async t => {
  const dir = workspace(t), runDir = fixture(dir), output = path.join(dir, 'qualification');
  const original = fs.readFileSync(path.join(runDir, 'run-summary.json'));
  const results = await importBenchmarkEvidence(output, { runDir });
  assert.equal(results[0].passed, true, JSON.stringify(results[0].responseBody));
  assert.equal(results[1].passed, false, 'a scorer-only fixture cannot establish product qualification');
  assert.equal((results[0].responseBody as any).independentlyValidated, false);
  assert.equal((results[0].responseBody as any).reconstruction.rescored, 'compared');
  assert.deepEqual(loadEvidence(output, 'benchmark'), results);
  assert.equal(loadRunnerEvidence(output).get('BENCHMARK-ENGINEERING-GATES')?.passed, false);
  generate(output, output);
  const document = fs.readFileSync(path.join(output, '20-test-execution-records.md'), 'utf8');
  assert.match(document, /BENCHMARK-RECONSTRUCTION/);
  assert.doesNotMatch(document, /Send OFFLINE request/);
  assert.deepEqual(fs.readFileSync(path.join(runDir, 'run-summary.json')), original);
  await assert.rejects(importBenchmarkEvidence(output, { runDir }), /already exists/);
});

for (const tamper of ['metrics', 'summary', 'missing', 'wrong-evaluator']) {
  test(`refuses ${tamper} evidence without converting missing checks to success`, async t => {
    const dir = workspace(t), runDir = fixture(dir);
    if (tamper === 'metrics') fs.writeFileSync(path.join(runDir, 'metrics.json'), '{"rows":[]}');
    if (tamper === 'summary') {
      const file = path.join(runDir, 'run-summary.json');
      const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
      summary.localEngineering = 'passed';
      fs.writeFileSync(file, JSON.stringify(summary));
    }
    if (tamper === 'missing') fs.unlinkSync(path.join(runDir, 'run-summary.json'));
    const results = await importBenchmarkEvidence(path.join(dir, 'qualification'), {
      runDir, ...(tamper === 'wrong-evaluator' ? { evaluatorRoot: dir } : {}),
    });
    assert.equal(results.length, 2);
    assert(results.every(result => result.passed === false));
  });
}
