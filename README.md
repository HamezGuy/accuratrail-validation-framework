# AccuraTrial EDC — 21 CFR Part 11 Validation Framework

Programmatic generation of formal validation packages for regulatory compliance.

## Quick Start

Use Node.js 20 or newer. PDF content qualification uses the pinned PDF.js parser;
it does not require a browser in this runner.

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

## Native synthetic qualification

OQ uses one fresh signed clinical fixture and separate disposable viewer accounts for lockout and password/session probes. It disables only those accounts, preserves the shared operator, and archives only its own synthetic study after the retention checks. Related evidence identifies shared PQ/OQ observations; those are not additional independent trials.

Audit mutation probes must first read an owned native record and then confirm that refusal left its contents unchanged. They establish API refusal, not database-trigger enforcement. The audit integrity check calls the native recomputation API and requires a nonempty complete scan with no unverifiable records, truncation, breaks, or deferred gaps. Native service evidence is distinct from independent database verification.

The CSV export checks every expected fixture value and native subject label. PDF checks explicitly request `outputFormat=pdf` with audit history and signatures, retain full bytes and their SHA-256 hash, and parse the document with pinned PDF.js in a bounded child process. They compare the complete owned scalar fixture's field census, displayed values and units, the subject label, current canonical signature manifestation, and the independently read correction's field, actor, old/new values and reason. Native form values and signature proof must remain unchanged across the download. A PDF-looking wrapper, HTML, missing text or wrong-scope source cannot pass. This verifies one owned form; rendered layout, full study/casebook coverage and independent clinical validation remain separate requirements. Parsing is capped at 25 MiB, 200 pages, one million text characters and 15 seconds, followed by at most five seconds to confirm process cleanup. A native parser fault fails the check without terminating the qualification controller; a result is accepted only after the parser exits successfully. Audit CSV is compared with the independently read correction, actor and reason. ODM checks its owned study/subject identity and does not claim complete clinical item mapping. Server/transport errors, missing observations, invalid request refusals on positive checks, and manual steps cannot become automatic passes. Password expiry, rate limiting and other controls require their actual observations; run results can remain failed even when offline contract tests pass.

The explicit mode connects OQ-154 and PQ-001 through PQ-040 to the existing signed study-definition workflow and the current native API. Use a local qualification environment with the official CORE validator, an authorized operator, and the immutable shared package already installed. Set `OQ_USERNAME` and `OQ_PASSWORD` through the environment (PQ-specific credentials are also supported). Run:

```powershell
npm run generate -- --pq --base-url http://localhost:3000 --synthetic-qualification
npm run generate -- --oq --base-url http://localhost:3000 --synthetic-qualification
```

Use the actual authorized API URL/port. This creates owned synthetic studies, native forms and observations, signed release/application/activation, enrollment and planned visits. PQ exercises field preservation, a signed query lifecycle, completion, stale-write refusal, SDV, signature invalidation/re-signing, signed freeze/unfreeze/lock, raw native value readback, and exact correction audit records. It soft-archives only its owned synthetic fixture after retention checks. OQ also soft-archives its owned fixture after all suites, including when a suite fails. Cleanup retains the canonical creation receipt and reconciles the exact identity again if the first independent readback failed. Evidence contains native commands and separate readbacks; credentials are redacted.

Missing conformance, governance or permission remains a failure. `--acknowledge-ungoverned` and `--acknowledge-incomplete` are explicit operator acknowledgments accepted only when the server permits them; the runner never adds these in response to a failure. A nonlocal target additionally requires `--allow-production-qualification`. Without `--synthetic-qualification`, setup remains a draft and dependent cases remain blocked.

The broader manual/UI protocol now uses **PQM-001 through PQM-022**. Its report mappings remain pending until those exact cases have evidence; automated **PQ-000 through PQ-040** results cannot stand in for manual backup/recovery or other unrelated cases. The generated execution records describe each executed automated case. Tests under `tests/pq-workflow.contract.test.ts` are offline wire-contract checks, not native qualification, clinical validation, independent review, or evidence of human time savings.
