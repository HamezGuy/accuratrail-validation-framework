# AccuraTrial EDC — 21 CFR Part 11 Validation Framework

Programmatic generation of formal validation packages for regulatory compliance.

## Quick Start

```bash
cd validation-framework
npm install
npm run generate:docs   # Generate all documents (no live tests)
npm run generate:all    # Generate documents + run IQ/OQ/PQ tests
```

## CLI Options

```bash
npx ts-node generate.ts --docs-only          # Documents only
npx ts-node generate.ts --iq                 # Docs + IQ tests
npx ts-node generate.ts --oq                 # Docs + OQ tests
npx ts-node generate.ts --pq                 # Docs + PQ tests
npx ts-node generate.ts --all                # Everything
npx ts-node generate.ts --only traceability-matrix  # Single document
npx ts-node generate.ts --version "v2.1"     # Custom version label
npx ts-node generate.ts --benchmark-run "C:/path/to/retained-run" --version "benchmark-001"
```

## Output

Each run creates a versioned folder under `output/`:

```
output/2026-05-02_v1.0/
  00-cover.md
  01-applicability-assessment.md
  02-validation-plan.md
  03-user-requirements-spec.md
  04-functional-requirements-spec.md
  05-risk-assessment.md
  06-traceability-matrix.md
  07-iq-protocol.md
  08-oq-protocol.md
  09-pq-protocol.md
  10-deviation-log.md
  11-capa-records.md
  12-validation-summary.md
  13-sop-gap-analysis.md
  14-hipaa-assessment.md
  15-training-matrix.md
  16-release-gate-checklist.md
  evidence/iq/  evidence/oq/  evidence/pq/
```

## Architecture

- **config/** — Human-editable system metadata, regulatory scope, risk ratings
- **collectors/** — Read-only codebase introspection (routes, services, migrations, SOPs, tests)
- **generators/** — Document generators producing formal markdown from collector data
- **runners/** — Live test executors for IQ/OQ/PQ evidence capture
- **runners/benchmark-evidence.ts** — Offline import of reconstructed CommandCenter benchmark evidence, using its existing scorer without recalculating competing metrics
- **templates/** — Editable document header/footer templates

## Updating

1. Edit `config/system-info.ts` with new version info before each release
2. Edit `config/regulatory-scope.ts` if regulatory scope changes
3. Edit `config/risk-ratings.ts` to adjust risk levels
4. Re-run `npm run generate:all` to regenerate the full package

## Clinical operations benchmark evidence

`--benchmark-run` imports an existing scored CommandCenter synthetic-trial run.
It invokes the canonical checkout's `synthetic-trial/evaluate/reconstruct.mjs`
to verify retained inputs, metric/gate derivation, and byte-for-byte re-scoring.
It does not run any product or model. Missing evidence, tampering, a mismatched
evaluator, and failed/blocked engineering gates produce failed qualification
evidence and a nonzero CLI exit. Use a new `--version` for every import; existing
benchmark evidence is never overwritten. `--docs-only` skips the import.

For older retained runs, add `--benchmark-evaluator-root C:/path/to/archive`
pointing to the archived evaluator recorded in the run. The CommandCenter
reconstructor verifies its content identity; do not edit the frozen run or
substitute today's scores. Historical reconstruction may require the original
`SYNTHETIC_TRIAL_DATA_ROOT` and retained source inputs.

Evidence appears under `evidence/benchmark/`, in the execution records, master
evidence index, and supplemental validation summary. Reconstruction success and
engineering gate success are separate checks. All other gates and the original
metrics remain authoritative. An import is synthetic engineering evidence; it
does not establish independent clinical validation or achievement of SURPASS
targets. Preserve the retained run and its evaluator alongside the qualification
package: the import links and hashes the originals rather than copying sealed
case-level answer keys.

Run `npm run test:benchmark` with the sibling CommandCenter checkout present to
exercise the adapter against the real scorer fixture, including tampered,
missing, mismatched-evaluator, and blocked-gate cases. This checks the adapter;
it is not a product benchmark. See [P13 evidence attachment contract](docs/p13-evidence-attachment.md)
for the separate protocol-extraction evaluation boundary.
