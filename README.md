# AccuraTrial EDC — 21 CFR Part 11 Validation Framework

Programmatic generation of formal validation packages for regulatory compliance.

## Quick Start

Use Node.js 20 or newer. PDF content qualification uses the pinned PDF.js parser;
it does not require a browser in this runner.

```bash
cd validation-framework
npm install
npm run generate:docs   # Generate all documents (no live tests)
npm run generate:all -- --base-url http://localhost:3000 --release-api <sha> --release-ui <sha> --release-core <sha> \
  --synthetic-qualification --retain-root C:/Projects/.synthetic-trial-data/runs/validation-packages
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
npx ts-node generate.ts --iq ... --retain-root <dir>  # Live runners: a retained, sealed evidence package
npx ts-node generate.ts --iq ... --no-retain         # Live runners: a development run, not retained
npm run verify:package -- <package directory>        # Recheck a sealed package; prints its manifest SHA-256
```

### Retained evidence packages

Executed evidence goes to a retained package, never to the git-ignored
`output/` folder. `--retain-root <dir>` creates
`<dir>/<yyyymmddTHHMMSSZ>-<version>-<first 8 hex of the package ID>/`
exclusively (the leaf is never created recursively, so an existing one is
refused and a retained package is never overwritten), and everything the run
writes goes there. At the end, whatever the outcome, the package is sealed:
`TMF-FILING.md` is written, every file is listed with its byte count and
SHA-256 in `package-manifest.json` (contract `validation-evidence-package/1`,
`contracts/validation-evidence-package-v1.schema.json`) with a package hash over
the canonical JSON of the manifest, and every file is set read-only. The run
then prints the SHA-256 of `package-manifest.json`. A package sets no
`output/latest` pointer.

```
<dir>/<yyyymmddTHHMMSSZ>-<version>-<id8>/
  01-applicability-assessment.md ... 21-design-specification.md
  TMF-FILING.md                 how people file and approve the package in the eTMF
  inputs/<role>.json            byte copies of the plans and captures the run read
  evidence/<category>/...       iq, oq, pq, security, dr, performance, benchmark, p13
  evidence/MASTER-EVIDENCE-INDEX.md
  package-manifest.json         written last
```

Whether a package is synthetic is computed, never chosen: it is synthetic when
`--synthetic-qualification` is given, when a `--benchmark-run` or `--p13-plan`
import ran (both are synthetic engineering evidence), or, once the platform
summary lands, when an entry of its platform evidence plan is synthetic; this
holds for documents packages too. A synthetic package is retained only under
the `runs/validation-packages` directory of a synthetic data root (a tree
holding `SYNTHETIC-TRIAL-DATA-ROOT`, searched upwards from the retain root),
that is `C:/Projects/.synthetic-trial-data/runs/validation-packages`. A package
that is not synthetic is refused inside such a tree and needs a retention root
QA names. No package is retained inside a git checkout. In a synthetic package
every record carries `synthetic: true`, each category summary carries the
synthetic notice and every document opens with "SYNTHETIC ENGINEERING EVIDENCE.
Synthetic data on a test stack. Not a real trial, not an approval."

Inputs are copied byte for byte into `inputs/<role>.json` with their SHA-256
and original path: `--p13-plan` (`p13-plan`), `--training-evidence`
(`training-evidence`), and for `--benchmark-run` the run's `run-summary.json`
and `metrics.json` (`benchmark-run-summary`, `benchmark-metrics`), so the
package keeps them when the data root's retention later moves the run. Inputs
are read and checked before the package is created: an input that cannot be
read, is not JSON, or holds a credential (a password, token, secret or API key
value rather than the name of the environment variable that holds it, a URL
with a user and password, or an authorization header value) refuses the run
and leaves nothing behind.

Live runners refuse to start without `--retain-root` or `--no-retain`.
`--no-retain` writes `output/<date>_<version>` scratch and stamps every record
(`retention`), category summary and document "Development run: not retained,
not validation evidence". An evidence import given neither flag runs as before
into that stamped scratch and says that nothing was retained; the import is
offline and repeatable from its retained run directory. A documents-only run
without either flag is plain scratch; with `--retain-root` it is a documents
package (`executed: false`).

`npm run verify:package -- <dir>` exits 0 only when every listed file is present
with its byte count and SHA-256, no unlisted file exists and the package hash
recomputes; it also checks that the inputs and evidence counts match their
files, that a synthetic package marks every record and document, and that no
record or document of a package is stamped as a development run. On success it
prints the SHA-256 of `package-manifest.json`, the `contentHash` the eTMF must
show for the filed manifest. `TMF-FILING.md` gives the filing steps: upload
`package-manifest.json` (and `12-validation-summary.md` for reading) as
REGULATORY documents, file them at platform scope, a different person accepts
them in QC review, and a QA lead approves the governance `document` assignment
to the "Computerised system validation package" requirement with the TMF
decision signature, without `provenance`. A synthetic package is filed, if at
all, only in an IL project on a test stack to show the mechanics.

### Target system

Live runners (`--iq`, `--oq`, `--pq`, `--security`, `--dr`, `--perf`, `--all`) have no
default target. Pass `--base-url` with the API under test, for example
`--base-url http://localhost:3000`; the command stops before any runner when it is
missing. Documents only and offline benchmark imports need no target.

The production host is refused. A production host is the production API or
frontend in `config/system-info.ts`, or any other host under `accuratrials.com` or
`acuratrials.com` that the file does not list as staging. Only an approved
production run may pass `--allow-production-target`; that flag does not replace
`--allow-production-qualification`, which every nonlocal qualification still needs.

### Release under test

Live runners also require the release they qualify: `--release-api`,
`--release-ui` and `--release-core`, each a full 40-character Git commit or a
`sha256:<64 hex>` container image ID of the deployed component. The run reads the
target's `GET /health` before any runner and records what it reports. When that
body carries `release.api`, `release.ui` or `release.core`, each must equal the
operator input or no runner starts; today the API reports only its semantic
version, so the identity is the operator's input and is labelled as such.

`--release-training` states the training service release the same way. The UI,
core and training also take `none` for a component that is not deployed;
`--release-api none` is refused, because the API is the system under test. Either
one makes the identity `validation-release-identity/2`: all four components
(`api`, `ui`, `core`, `training`) must then be stated, and the identity hash is
the SHA-256 of the four lines `name=kind:identity` in that order, a `none`
hashing as `not-deployed:-`. Without them the identity stays
`validation-release-identity/1`, with the same bytes and hash as before version
2. The training release matters wherever the training service decides clinical
saves (`TRAINING_SERVICE_URL` set on the stack), so a run that selects the TA3
OQ suites (13 to 18) must state it: `requireTrainingRelease` in
`runners/release-identity.ts` is the check that refuses such a run before any
runner starts.

Every evidence record carries `releaseUnderTest` (the three identities, or four
in version 2, their SHA-256 identity hash and the framework commit). Each
category's summary, execution report and `release-identity.json` hold the full
identity with the target's observation, generated documents list it in their
metadata, and the master evidence index shows each category's release and flags
categories produced against different releases. Evidence readers accept
versions 1 and 2 and refuse any other. A version 1 identity names no training
release, so its training row and column read "not recorded"; a component stated
as `none` reads "not deployed". Documents generated without a release are marked
"not recorded".

```powershell
npm run generate -- --oq --base-url http://localhost:3000 --synthetic-qualification --no-retain `
  --release-api <api commit> --release-ui <ui commit> --release-core <core image id>
npm run generate -- --oq --base-url http://localhost:3000 --synthetic-qualification `
  --release-api <api commit> --release-ui none --release-core none --release-training <training commit> `
  --retain-root C:/Projects/.synthetic-trial-data/runs/validation-packages --version val1-oq-<date>
```

### System description and test environment

`config/system-info.ts` describes production as libreclinicaapi
`production-deployment/DEPLOY_ECS.md` documents it: ECS Fargate in us-east-2 for
the API, core and training services, RDS PostgreSQL 14 (`accuratrials-hipaa-db`)
and the frontend on Vercel. The Intelligence Layer is a separate system outside
this release. The OQ and PQ protocols and the execution records never print the
production environment as the environment under test: the API is the target the
run's release identity observed, and every other environment detail reads
"Recorded at execution".

### Approval

Generated documents carry no signature lines. Every approval block, the master
evidence index and the editable templates state "Approval of this document is
recorded in the eTMF as a governance decision on the filing of this package
(TMF-FILING.md). This file carries no signature." and list each role as "To
approve"; every retained package holds its `TMF-FILING.md`. The framework never signs: a QA lead other than the person who files
the package approves it in the eTMF, and that decision is a Part 11 signature
only where the eTMF requires signed decisions (`IL_TMF_SIGNATURE=required`).

### OQ case registry and training evidence

`config/oq-case-registry.ts` is the one list of OQ cases (OQ-001 to OQ-205 in
twelve suites). The OQ runner records a result for exactly these IDs and the OQ
protocol lists exactly these IDs, so the protocol cannot fall behind the runner.
Suites 1 to 7 keep their detailed protocol steps; suites 8 to 12 are listed by
case, with each case's description, acceptance criteria and regulatory reference
recorded in its evidence record. OQ-073 to OQ-075 are defined but not automated;
the runner records them as not executed.

`15-training-matrix.md` is generated from the training module's own
`training-inspection-evidence/1` capture. Pass it with
`--training-evidence C:/path/to/capture.json`; the file is checked (contract,
completeness, every row's SHA-256) and retained as
`evidence/training/training-inspection-evidence.json`. The matrix shows each
course's required roles, assigned, completed, verified and overdue obligations
per role, refresher intervals and the module's own gaps. Without a capture the
document says so and shows no requirement table.

`config/tests-live-mapping.ts` feeds the traceability matrix's "Live Workflow
Script Coverage" section, which lists the accuratrial-tests-live scripts that
exercise each case and marks any mapped script missing from that checkout. The
live suite retains only failures, so these rows are coverage pointers, not
execution evidence.

### ICH E6(R3) references

Generated documents cite ICH E6(R3) (ICH Step 4, 6 January 2025) only through
`config/regulatory-scope.ts`: `ICH_E6_R3.citation` for a general mention and
`e6r3(key)` for a topic in `E6_R3_REFERENCES`. The section numbers there are an
analyst's reading of the Step 4 text, which no retained copy pins, so they are
pending QA verification: every document header states that status and the
validation plan lists the whole mapping. A correction is one edit to the
mapping. `tests/e6-r3-references.contract.test.ts` fails when a tracked file
outside `vendor/` or a generated document cites the superseded revision, or a
generator cites a key the mapping lacks.

## Output

A run with `--retain-root` writes a retained package (see "Retained evidence
packages"). Any other run writes git-ignored scratch, a versioned folder under
`output/` that a same-day rerun with the same version overwrites:

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

## Shared types build

The framework builds on the same `@accura-trial/shared-types` build as the EDC
API: `vendor/` holds byte copies of the API's archive and its
`edc-study-contract-package/1` receipt (0.2.0 build `d786631b516b95fc`), and
`package.json` and the lockfile name that archive with the receipt's integrity.
Install with `npm install --offline`. `tests/shared-types-parity.contract.test.ts`
(in `test:contracts`) checks the archive against its receipt, the lockfile and
the installed release manifest. `npm run test:cross-repo` reads the sibling
libreclinicaapi checkout and fails, naming the missing path, unless both
repositories pin the same build with identical archive and receipt bytes; it
never skips. When the API re-vendors, copy its new archive and receipt here,
delete the old pair and reinstall.

## Architecture

- **config/** — Human-editable system metadata, regulatory scope, risk ratings
- **collectors/** — Read-only codebase introspection (routes, services, migrations, SOPs, tests)
- **generators/** — Document generators producing formal markdown from collector data
- **runners/** — Live test executors for IQ/OQ/PQ evidence capture
- **runners/benchmark-evidence.ts** — Offline reconstructed CommandCenter evidence and scoped read-only native P13 attachment, preserving each authoritative evaluator's metrics
- **runners/evidence-package.ts**: retained packages: exclusive creation, inputs, sealing and verification
- **contracts/**: the versioned JSON Schema contracts the framework produces (contracts/README.md)
- **scripts/verify-package.ts**: `npm run verify:package`
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
benchmark evidence is never overwritten. `--docs-only` skips the import. Without
`--retain-root` the import writes stamped scratch; with it, the synthetic package
also keeps the run's `run-summary.json` and `metrics.json` as inputs.

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

`--p13-plan C:/qualification/p13-plan.json` attaches a scoped native P13 terminal
record using three authenticated GETs and an explicit expected identity/census
plan. It preserves source refs, native metric statuses and available denominators;
it does not execute models or independently re-score the native record. Use a new
`--version` for each attachment. Failed, incomplete and vacuous evidence produces
a nonzero exit; `--docs-only` skips retrieval. See the linked P13 contract for the
strict plan fields, token environment variable, local/nonlocal target controls
and remaining native/independent-validation requirements.

## Native synthetic qualification

OQ uses one fresh signed clinical fixture and separate disposable viewer accounts for lockout and password/session probes. It disables only those accounts, preserves the shared operator, and archives only its own synthetic study after the retention checks. Related evidence identifies shared PQ/OQ observations; those are not additional independent trials.

Audit mutation probes must first read an owned native record and then confirm that refusal left its contents unchanged. They establish API refusal, not database-trigger enforcement. The audit integrity check calls the native recomputation API and requires a nonempty complete scan with no unverifiable records, truncation, breaks, or deferred gaps. Native service evidence is distinct from independent database verification.

The CSV export checks every expected fixture value and native subject label. PDF checks explicitly request `outputFormat=pdf` with audit history and signatures, retain full bytes and their SHA-256 hash, and parse the document with pinned PDF.js in a bounded child process. They compare the complete owned scalar fixture's field census, displayed values and units, the subject label, current canonical signature manifestation, and the independently read correction's field, actor, old/new values and reason. Native form values and signature proof must remain unchanged across the download. A PDF-looking wrapper, HTML, missing text or wrong-scope source cannot pass. This verifies one owned form; rendered layout, full study/casebook coverage and independent clinical validation remain separate requirements. Parsing is capped at 25 MiB, 200 pages, one million text characters and 15 seconds, followed by at most five seconds to confirm process cleanup. A native parser fault fails the check without terminating the qualification controller; a result is accepted only after the parser exits successfully. Audit CSV is compared with the independently read correction, actor and reason. ODM checks its owned study/subject identity and does not claim complete clinical item mapping. Server/transport errors, missing observations, invalid request refusals on positive checks, and manual steps cannot become automatic passes. Password expiry, rate limiting and other controls require their actual observations; run results can remain failed even when offline contract tests pass.

The explicit mode connects OQ-154 and PQ-001 through PQ-040 to the existing signed study-definition workflow and the current native API. Use a local qualification environment with the official CORE validator, an authorized operator, and the immutable shared package already installed. Set `OQ_USERNAME` and `OQ_PASSWORD` through the environment (PQ-specific credentials are also supported). Run:

```powershell
npm run generate -- --pq --base-url http://localhost:3000 --synthetic-qualification --release-api <sha> --release-ui <sha> --release-core <sha> --retain-root C:/Projects/.synthetic-trial-data/runs/validation-packages
npm run generate -- --oq --base-url http://localhost:3000 --synthetic-qualification --release-api <sha> --release-ui <sha> --release-core <sha> --retain-root C:/Projects/.synthetic-trial-data/runs/validation-packages
```

Use the actual authorized API URL/port. This creates owned synthetic studies, native forms and observations, signed release/application/activation, enrollment and planned visits. PQ exercises field preservation, a signed query lifecycle, completion, stale-write refusal, SDV, signature invalidation/re-signing, signed freeze/unfreeze/lock, raw native value readback, and exact correction audit records. It soft-archives only its owned synthetic fixture after retention checks. OQ also soft-archives its owned fixture after all suites, including when a suite fails. Cleanup retains the canonical creation receipt and reconciles the exact identity again if the first independent readback failed. Evidence contains native commands and separate readbacks; credentials are redacted.

Missing conformance, governance or permission remains a failure. `--acknowledge-ungoverned` and `--acknowledge-incomplete` are explicit operator acknowledgments accepted only when the server permits them; the runner never adds these in response to a failure. A nonlocal target additionally requires `--allow-production-qualification`. Without `--synthetic-qualification`, setup remains a draft and dependent cases remain blocked.

The broader manual/UI protocol now uses **PQM-001 through PQM-022**. Its report mappings remain pending until those exact cases have evidence; automated **PQ-000 through PQ-040** results cannot stand in for manual backup/recovery or other unrelated cases. The generated execution records describe each executed automated case. Tests under `tests/pq-workflow.contract.test.ts` are offline wire-contract checks, not native qualification, clinical validation, independent review, or evidence of human time savings.
