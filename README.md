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
npx ts-node generate.ts --iq ... --target-config <file>  # The configuration under test (IQ-033)
npx ts-node generate.ts --oq ... --ta3-oq-plan <file>    # OQ suites 13 to 18 against the study a ta3-oq-plan/1 names
npx ts-node generate.ts --oq ... --oq-suites 13-18       # Run only these OQ suites (1 to 12 go together)
npx ts-node generate.ts --docs-only --platform-evidence <file>  # Platform summary (document 22) with the evidence a plan cites
npx ts-node generate.ts --docs-only --platform-root <dir>       # Read the estate repositories under another root
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
  01-applicability-assessment.md ... 22-platform-validation-summary.md
  platform-validation-summary.json  the platform summary's data (platform-validation-summary/1)
  TMF-FILING.md                 how people file and approve the package in the eTMF
  inputs/<role>.json            byte copies of the plans and captures the run read
  evidence/<category>/...       iq, oq, pq, security, dr, performance, benchmark, p13
  evidence/MASTER-EVIDENCE-INDEX.md
  package-manifest.json         written last
```

Whether a package is synthetic is computed, never chosen: it is synthetic when
`--synthetic-qualification` is given, when a `--benchmark-run` or `--p13-plan`
import ran (both are synthetic engineering evidence), or when an entry of the
platform evidence plan (`--platform-evidence`) is synthetic; this holds for
documents packages too. A synthetic package is retained only under
the `runs/validation-packages` directory of a synthetic data root (a tree
holding `SYNTHETIC-TRIAL-DATA-ROOT`, searched upwards from the retain root),
that is `C:/Projects/.synthetic-trial-data/runs/validation-packages`. A package
that is not synthetic is refused inside such a tree and is retained only under
a retention root QA names: a tree holding `QA-RETENTION-ROOT`, a marker file
QA places (searched upwards from the retain root; no code creates it, and none
exists tonight, so such a run stays scratch). A synthetic package is refused in
such a tree. No package is retained inside a git checkout. A package is the run
of one framework commit: `--retain-root` is refused before anything is created
when this checkout has a modified tracked file or an untracked file (an ignored
one, such as `output/` or `node_modules/`, does not count) or its commit cannot
be read. `--allow-dirty-framework` retains such a run anyway, for development
only: its `TMF-FILING.md` opens with "NOT A RUN OF RECORD: framework checkout
dirty or changed during the run", as does that of any package whose checkout is
dirty or at another commit when it is sealed, and the run and
`npm run verify:package` print that line; the manifest gains no member (its
`framework` records the checkout at the seal). In a synthetic package
every record carries `synthetic: true`, each category summary carries the
synthetic notice and every document opens with "SYNTHETIC ENGINEERING EVIDENCE.
Synthetic data on a test stack. Not a real trial, not an approval."

Inputs are copied byte for byte into `inputs/<role>.json` with their SHA-256
and original path: `--p13-plan` (`p13-plan`), `--training-evidence`
(`training-evidence`), `--target-config` (`target-configuration`, read strictly
against its contract first), `--ta3-oq-plan` (`ta3-oq-plan`, read strictly too),
`--platform-evidence` (`platform-evidence-plan`, read strictly too, in every
mode, documents runs included), and for `--benchmark-run` the run's `run-summary.json`
and `metrics.json` (`benchmark-run-summary`, `benchmark-metrics`), so the
package keeps them when the data root's retention later moves the run. Inputs
are read and checked before the package is created: an input that cannot be
read, is not JSON, or holds a credential (a password, token, secret or API key
value rather than the name of the environment variable that holds it, also under
any member name ending in token, secret or private key, a URL with a user and
password, an authorization header value, a JSON Web Token or a PEM block)
refuses the run and leaves nothing behind. A member name ending in `Env` names
the environment variable and is not a credential.

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
files, that `configurationUnderTest` is recorded exactly when a declaration is
retained and holds that declaration's SHA-256 and flags and the mismatches the
retained IQ and OQ records give, that every benchmark record's `summarySha256`
and `metricsSha256` are the retained run summary and metrics inputs, that a synthetic package
marks every record and document, and that no record or document of a package is
stamped as a development run. On success it
prints the SHA-256 of `package-manifest.json`, the `contentHash` the eTMF must
show for the filed manifest. `TMF-FILING.md` gives the filing steps: upload
`package-manifest.json` (and `12-validation-summary.md` and
`22-platform-validation-summary.md` for reading) as
REGULATORY documents, file them at platform scope, a different person accepts
them in QC review, and a QA lead approves the governance `document` assignment
to the "Computerised system validation package" requirement with the TMF
decision signature, without `provenance`. A synthetic package is filed, if at
all, only in an IL project on a test stack to show the mechanics. A package
that retains the training module's privileged inspection capture
(`inputs/training-evidence.json` or `evidence/training/`, which hold
assessment answer keys) opens its `TMF-FILING.md` with "RESTRICTED: this
package holds the training module's privileged inspection capture, ...": it is
kept where only holders of training inspection authority read it, and those
files are never uploaded, so IL viewers of the filing retrieve no evidence
content (IR-453). The run and `npm run verify:package` print that line too.

### Target system

Live runners (`--iq`, `--oq`, `--pq`, `--security`, `--dr`, `--perf`, `--all`) have no
default target. Pass `--base-url` with the API under test, for example
`--base-url http://localhost:3000`; the command stops before any runner when it is
missing. Documents only and offline benchmark imports need no target. The
security and performance runners, which send injection and token attacks and
concurrent logins, refuse a target other than `localhost`, `127.0.0.1` or
`[::1]` without `--allow-production-qualification`, as the OQ and PQ
qualification fixtures do.

### Configuration under test

`--target-config <file>` names a `validation-target-configuration/1` declaration
of the target's settings (contract and allowlist in
`contracts/validation-target-configuration-v1.schema.json` and
`contracts/README.md`). Before any runner starts, the run refuses a declaration
that cannot be read, holds a member or flag off the allowlist, or describes
another target than `--base-url`; it needs a live runner, and `--docs-only` reads
none. A retained package copies it to `inputs/target-configuration.json`, and
IQ-033 checks that copy: the target, the source file's SHA-256 when the file is
present, and, for a compose file, that the `core-api` service environment sets
each declared flag as declared, read as the EDC reads it (a value an
interpolation or the shell supplies is listed undetermined, and so is every key
absent from a service that has its own `env_file`, `<<:` merge key or
`extends:`; `ENABLE_DOMAIN_EVENTS` is on when it or
`EDC_PLATFORM_EVENTS_PROTOTYPE_ENABLED` is `true`, as the EDC's
`domainEventsEnabled()` reads them). The record states
the delta to libreclinicaapi `.env.production.example` for the same flags and
that live production values are not visible. IQ-029 reads the same declaration
for environment segregation: neither the declared target nor `--base-url` is
the production API host, and the source file is no production configuration
file (a production target records `TARGET_IS_PRODUCTION`). Without a
declaration IQ-029 and IQ-033 are not executed (`NO_TARGET_CONFIGURATION`).
When the package is sealed, the manifest's `configurationUnderTest` records
the declaration with every contradiction IQ-033 and the observing OQ cases
recorded; each observing case reads only its own disabled code
(`ENGINE_DISABLED` for OQ-206, `FEATURE_DISABLED_AT_TARGET` for the O-1 and
W-1 cases) as its flag off.

```powershell
npm run generate -- --iq --base-url http://localhost:3000 --synthetic-qualification `
  --release-api <api commit> --release-ui none --release-core none --release-training <training commit> `
  --target-config C:/path/to/target-configuration.json `
  --retain-root C:/Projects/.synthetic-trial-data/runs/validation-packages --version val1-iq-<date>
```

### Production settings and vendored receipts

IQ-034 lists every key that libreclinicaapi `.env.production.example` or the
`core-api` environment of EDCProjectCompliant `docker-compose.production.yml`
sets and nothing reads: a key is read when libreclinicaapi `src` (test files
excluded) holds `process.env.KEY`, an environment parameter's `env.KEY`, or the
key as a whole string literal (the form helpers that read `process.env[name]`
take), or when the Node.js runtime or the AWS SDK reads it. Each dead key is
listed with the file and line that set it, and with the name the code reads
instead where one is known; the case fails while any exists (today, among
others, `STRICT_VALIDATION_RULE_SIGNATURES` and the four `BACKUP_` keys).
IQ-035 checks every `file:vendor/*.tgz` dependency of the API against the
receipt beside its archive (package, file name, byte count, SHA-256 and
integrity) and the lockfile's integrity; the interop archive, which has no
receipt, fails it. IQ-001 passes only when `GET /health` reports a `version`
equal to `SYSTEM_INFO.version` (`config/system-info.ts`, the EDC API's
`APP_VERSION` label); another or no version fails `VERSION_MISMATCH`. The IQ
protocol has 35 cases, and the runner records a result for each.

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
"not recorded". An execution report's "Saved At" is when it was written (the
summary's `executedAt`), and "Cases Executed" gives the first and last record
time, when the cases ran.

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
run's release identity observed (a version endpoint that did not answer is
stated as failed, never as observed), and every other environment detail reads
"Recorded at execution". The IQ, OQ and PQ protocols are generated again after
the runners, so they name that target. The system version is the label the EDC
API reports at `/health` (0.1.0); the build under test is the release
identity. The execution records date the run from the records' own timestamps.
Every pass count names the registry cases (a prefix and three digits, for example
OQ-206) apart from the bookkeeping rows (setup, sessions, cleanup, import steps)
that category totals and package manifests still count.

### Approval

Generated documents carry no signature lines. Every approval block, the master
evidence index and the editable templates state "Approval of this document is
recorded in the eTMF as a governance decision on the filing of this package
(TMF-FILING.md). This file carries no signature." and list each role as "To
approve"; every retained package holds its `TMF-FILING.md`. The framework never signs: a QA lead other than the person who files
the package approves it in the eTMF, and that decision is a Part 11 signature
only where the eTMF requires signed decisions (`IL_TMF_SIGNATURE=required`).

### TA3 OQ suites 13 to 18

OQ-206 to OQ-244 qualify the TA3 uses (spec P20 3.4): deviation detection on
save and in the sweep with the follow-up task (13), protocol version
applicability (14), signed assessment and reviewer independence (15, O-1),
escalation timing (16, O-2), the TA3 ledger records and blinding (17, M-2 for
OQ-237) and inspection copy completeness (18, W-1). They run against the
designated armed synthetic study a `ta3-oq-plan/1` names (`--ta3-oq-plan`;
contract in `contracts/ta3-oq-plan-v1.schema.json`): a dedicated duplicate of
the release, never the study the O-7 benchmark scores, prepared by
VAL-1/validation-run step 0. The cases create and own only their own subjects,
forms, deviations, applicability rows, policy rows, milestones and documents,
labelled `OQ-TA3-<run id>-<n>` and listed in each suite's `OQ-TA3-SUITE-<n>`
row; an owned protocol version is withdrawn again, so the study stays usable
for the next run. Suite 14 writes nothing at an OQ site without applicability
records of its own (`VERSION_FIXTURE_ABSENT`): such a site takes the platform
study's records, and any record written there, even withdrawn, would end that.
The escalation policy OQ-227 puts in force on the platform study cannot be
retired by the run (O-2 replaces a policy only by another signed one), so
`OQ-TA3-SUITE-16` lists it under `persisting`, and suite 16 runs only on a
study the plan declares a duplicate (`study.duplicateOf`; otherwise every case
records `DUPLICATE_STUDY_NOT_DECLARED` and no request is made). The plan names
five different synthetic people (operator, reviewer, third person, blinded,
monitor) by the environment variables that hold their credentials; the
operator defaults to `OQ_USERNAME` and `OQ_PASSWORD`. Two accounts whose
variables hold the same username, trimmed as the EDC's login trims it, are
refused before any request, suite 1 included. Two accounts the EDC answers
with one user id at login are one person too: the cases of the suite that
finds it record `ACCOUNTS_NOT_DISTINCT`, and its `OQ-TA3-SUITE-<n>` row fails.
A retained TA3 exchange keeps no arm-grouped content (IR-453, D-25): in each
JSON reply, every value `armGroupedContent` lists (allocation counts, `byArm`,
per-arm target dates and first dosing, an arm, a window ending at per-arm first
dosing that is not withheld) and every member named as an arm (`armId`,
`treatmentArm`, `studyGroupId` and the like) becomes `{"withheld":
"arm-grouped content (D-25)", "sha256": ...}`, the SHA-256 of its canonical
JSON. Record ids, `contentHash` and member names stay, and each case checks the
reply as the EDC sent it; an exact-bytes read keeps only its digest, as before.

A plan needs `--oq`, `--synthetic-qualification` (the suites write owned
records, as the owned fixture does) and `--release-training` (the training
gate decides every clinical save), and is checked before any runner starts; a
retained package copies it to `inputs/ta3-oq-plan.json` and the OQ runner reads
that copy, with the retained `--target-config` declaration, whose flags suite
18 needs. The OQ runner runs suites 1 to 12, their fixture cleanup and logout,
then the TA3 suites (each logging its accounts in and out, escalation last),
then the login quota probe. A session logs in again before its token expires
or after 25 idle minutes. A 401 of an ended session (`INVALID_TOKEN`,
`TOKEN_REVOKED`, `SESSION_REVOKED`, `SESSION_NOT_ACTIVE` or `SESSION_TIMEOUT`)
gets one new login and one retry; any other 401, a refused Part 11 signature
among them, is the answer and is not resent. A write's transport error is
never resent. Waits
poll every 30 seconds within the plan's bounds (`sweep.maxWaitMinutes`, default
5; `escalation.maxWaitMinutes`, default 0: OQ-228 and OQ-229 need 70 minutes,
OQ-230 four). `--oq-suites 13-18` runs only the TA3 suites; suites 1 to 12 are
selected together or not at all; an unselected case records
`OQ_SUITE_NOT_SELECTED`.

A case whose feature is absent at the release (an unknown-route 404, a 400 for
a request member a later item adds, or rows without O-1's record fields) fails
`FEATURE_ABSENT_AT_RELEASE`; one switched off at the target (503 with
`DEVIATION_DECISIONS_DISABLED` or `SEGMENTED_INSPECTION_EXPORT_DISABLED`) fails
`FEATURE_DISABLED_AT_TARGET`; the engine's own 503 fails `ENGINE_DISABLED`. A
flag the declaration states and the target contradicts is noted
`CONFIGURATION_MISMATCH` and reaches the sealed manifest. A case whose setup
cannot be made is recorded not executed with its code: `NO_TA3_PLAN`,
`ACCOUNT_LOGIN_FAILED`, `TRAINING_NOT_CURRENT`, `ESIGNATURE_NOT_ACKNOWLEDGED`,
`RECIPIENT_UNAVAILABLE`, `ESCALATION_WINDOW_NOT_WAITED`,
`VERSION_FIXTURE_ABSENT`, `DUE_AT_REFUSED`, `NO_TARGET_CONFIGURATION`,
`FOLLOW_UP_TASK_NOT_CONFIGURED`, `OPERATOR_NOT_UNBLINDED`, `SWEEP_RACED`,
`POLICY_DECIDER_UNAVAILABLE`, `DUPLICATE_STUDY_NOT_DECLARED`,
`ACCOUNTS_NOT_DISTINCT` or `PREREQUISITE_MISSING`. OQ-227 reads the policy
workspace first, so a release without O-2 fails `FEATURE_ABSENT_AT_RELEASE`
and a workspace stating `decisionsEnabled` false fails
`FEATURE_DISABLED_AT_TARGET`, whoever the staff list shows. It then sends no
policy decision unless the platform study's staff list shows the operator and
the reviewer as investigator or data manager, as O-2 requires
(`POLICY_DECIDER_UNAVAILABLE`; `FEATURE_DISABLED_AT_TARGET` instead when a
workspace without `decisionsEnabled` leaves `ENABLE_DEVIATION_DECISIONS` off
by the declaration or by O-1 in the same run). OQ-228 checks that the escalation names the
policy's recipient role and the recipient's staff list user id among its
`recipientUserIds`. A missing escalation in OQ-228 or OQ-230 records
`RECIPIENT_UNAVAILABLE` only when O-2 holds the level with that code
(`escalationAttempts`) or when the staff lists of the OQ site and its parent
were both read without the recipient in the role; otherwise it is a failure.
OQ-243 stays not executed (`SEGMENTED_READ_NOT_EXPOSED`)
until a user route downloads segmented copies. Without a plan no request is
made and every TA3 case records `NO_TA3_PLAN`. Should the TA3 run itself throw
(a suite records its own failures), an `OQ-TA3-EXECUTION` row names the
exception, every selected TA3 case records `PREREQUISITE_MISSING` and the base
suites' records are kept.

```powershell
npm run generate -- --oq --base-url http://127.0.0.1:<port> --synthetic-qualification `
  --release-api <api commit> --release-ui none --release-core none --release-training <training commit> `
  --ta3-oq-plan C:/Projects/.synthetic-trial-data/<plan>.json --target-config <declaration> `
  --retain-root C:/Projects/.synthetic-trial-data/runs/validation-packages --version val1-oq-<date>
```

`tests/ta3-oq.contract.test.ts` runs every suite against an in-process fake EDC
(`tests/fixtures/ta3-fake-edc.ts`) on a controlled clock, including the
disabled, absent and contradicted cases; `tests/fixtures/edc-k6b` holds byte
copies of two documents a real EDC retained, which the ledger checks read.
`npm run test:cross-repo` checks the TA3 cases against the libreclinicaapi
checkout: every non-late coverage table has a `CREATE TABLE`, the signature
meanings (`DEVIATION_ESCALATION_POLICY_MEANING` among them) are the EDC's, the
recipient role names are the ones O-2 resolves holders by (the EDC's auth-core
`getRoleByName` and `expandRoleAliases`), the M-2 block checks the
`edc-ta3-ledger/1` schema's required members and the EDC's synthetic ledger
fixture, read by the OQ-237 checks, and two blocks fail by name until their
items land: "W-1 not landed" (the coverage list must equal the `ta3: true`
declarations of `INSPECTION_STORES`) and "O-7 not landed" (the CommandCenter
deviation detection scorer and its reconstruction entry).

### OQ case registry and training evidence

`config/oq-case-registry.ts` is the one list of OQ cases (OQ-001 to OQ-244 in
eighteen suites; suites 13 to 18, OQ-206 to OQ-244, are the TA3 suites, appended
without renumbering). The OQ runner records a result for exactly these IDs and the OQ
protocol lists exactly these IDs, so the protocol cannot fall behind the runner.
Suites 1 to 7 keep their detailed protocol steps; suites 8 to 12 are listed by
case, with each case's description, acceptance criteria and regulatory reference
recorded in its evidence record; suites 13 to 18 are detailed from the TA3 case
catalog `config/ta3-oq-cases.ts`, which also gives each case's evidence record its
description, acceptance criterion, Part 11 and ICH E6(R3) references, and names the
plan item whose code the case needs (O-1, O-2, M-2 or W-1). OQ-073 to OQ-075 are
defined but not automated; the runner records them as not executed.
`config/ta3-inspection-coverage.ts` is W-1's TA3 inventory of the inspection copy
(spec P17 2.2.1: 39 tables, two of them in the segmented copy only, then the late
tables with the item that owns each).

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

### Platform validation summary (document 22)

`22-platform-validation-summary.md` and `platform-validation-summary.json`
(contract `platform-validation-summary/1`,
`contracts/platform-validation-summary-v1.schema.json`) list the fourteen
systems a TA3 use relies on, from `config/platform-inventory.ts`: the EDC API
and UI, LibreClinica core, the training service, the interop middleware,
shared types, auth core, the Intelligence Layer, the Clinical Semantic Layer,
the Command Center, the Biometrics Workbench, Data Manager Tools,
OpenStudyBuilder and this framework. Repositories resolve under
`--platform-root` (by default the parent of the EDC workspace, `C:/Projects`)
through `collectors/workspace-paths.ts`, and each is only read (`git rev-parse
HEAD`, `git status --porcelain --untracked-files=no`). For each system the
summary quotes the line that states its qualification status from the current
bytes, with the file's SHA-256 and line number ("statement not found:
inventory stale" when the literal moved), evaluates the gap probes (`contains`
keeps a gap open while its literal is present, `absent` while it is absent; a
gap without a probe is stated and re-verified at review), and names each gap's
plan item. The word "qualified" is never a status: a system shows "evidence
present, unapproved" when an admitted evidence entry verified or matched by
hash, else "gap"; approval is QA's act in the eTMF.

`--platform-evidence <file>` names a `platform-validation-evidence-plan/1`
(`contracts/platform-validation-evidence-plan-v1.schema.json`): per system,
sealed packages of this framework by the SHA-256 of their
`package-manifest.json`, verified with `verifyPackage`, and other files by
their SHA-256 alone. The plan is checked before anything runs: a system the
inventory lacks, an entry the system does not admit (the inventory names what
each system admits; the Intelligence Layer takes a package only with P13
evidence, the Command Center only with benchmark evidence), or a `synthetic`
declaration that differs from the cited manifest refuses it (also for a
`package-manifest.json` cited by hash alone); a hash that does
not match is shown as `mismatch`, a file or package that cannot be read as
`unreadable`. Any synthetic entry makes the run synthetic: a documents package
is then retained only under `runs/validation-packages` of the synthetic data
root, and a scratch run is stamped synthetic and not retained. A retained
package copies the plan to `inputs/platform-evidence-plan.json`, and the
summary reads that copy. Without a plan every system shows its gap.

The summary also compares the EDC API release of each cited OQ package with
the release a cited O-7 import recorded in PQT-005 (`same` only when every OQ
and O-7 pair compares; `RELEASE_MISMATCH`, which becomes a gap of the EDC API;
or `not-comparable`), and lists the
validated change awaiting change control: D-04, turning on
`ENABLE_DEVIATION_ENGINE`, `ENABLE_DOMAIN_EVENTS` and
`ENABLE_DEVIATION_DECISIONS` in the live trial, with their lines in the EDC
production profile, the OQ cases it needs (suites 13 to 16, OQ-206 to OQ-231)
and how many of them passed in each cited OQ package, the SOP-CC-001 category
(Critical: the System Owner and QA approve) and the status "no change-control
record exists". The framework creates no change-control record.

```powershell
npm run generate -- --docs-only --platform-evidence C:/path/to/platform-evidence-plan.json --version val1-platform-<date>
# When the plan cites a synthetic package, retain the documents package in the data root:
npm run generate -- --docs-only --platform-evidence C:/path/to/platform-evidence-plan.json `
  --retain-root C:/Projects/.synthetic-trial-data/runs/validation-packages --version val1-platform-<date>
```

`npm run test:cross-repo` builds the summary on the real sibling checkouts and
fails when a repository is missing, a statement moved or a probe stopped
matching, which forces an update of the inventory.

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

### TA3 records, requirements and risk ratings

The regulated records REC-016 to REC-028 (`config/regulatory-scope.ts`) are the
TA3 records: deviations, their rule specifications, receipts, applicability,
decisions and escalations, milestones, retained measurement documents,
inspection copies, data cuts, TA2 decisions, safety cases and this framework's
packages, each retained 15 years. `config/ta3-requirements.ts` holds the user
requirements URS-081 to URS-101 with their planned verification and their
functional requirements FRS-087 to FRS-107, one each: the URS prints them in its
"TA3 Platform Operations" category, the FRS in its section of that name, and
the traceability matrix one row per requirement. A requirement cites an OQ case
only where the case's implemented check matches it, and every case of suites 13
to 18 is cited by the requirement its catalog entry names; URS-099 (documents
on container disk, N-STORE), URS-100 and URS-101 are stated gaps, since no
runner case verifies them. The risk ratings FEAT-160 to FEAT-169
(`config/risk-ratings.ts`) have CSA records (19) that map each TA3 feature to
its verifying cases. `generators/helpers/compliance-mapping.ts` adds
`E6_R3_MAPPINGS` (every ICH E6(R3) topic with the cases that verify it) and
`TA3_USE_MAPPINGS` (each TA3 use with its suite), which the validation summary
(12) and the regulatory map (18) report from the retained cases; in those
tables, the CSA records and the TA3 traceability rows a case recorded not
executed (for example NO_TA3_PLAN) reads as not executed, never as passed or
failed. The regulatory map is generated again after the runners, as the summary
is. `tests/requirements.contract.test.ts` checks all of it.

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
  17-fda-supplemental.md
  18-regulatory-requirements-map.md
  19-csa-feature-assurance.md
  20-test-execution-records.md
  21-design-specification.md
  22-platform-validation-summary.md
  platform-validation-summary.json
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

IQ checks the installations, not a source folder. IQ-008 runs the EDC's own
`verifyPinnedStudyContract` (libreclinicaapi
`scripts/verify-study-contract-consumers.cjs`, loaded read-only; it installs
nothing and connects to nothing) on the API, the frontend (EDCProjectCompliant)
and this framework, each against the receipt beside its vendored archive, and
requires the framework's archive to be the API receipt's build. Consumers on
different builds (today the frontend runs 81eafbc49259f4f1 and the API
d786631b516b95fc) are recorded, not failed; a missing verifier, archive or
receipt fails the case naming its path. IQ-005 compares the frontend's
`@angular/core` major with `config/system-info.ts` (20), IQ-006 reads the
TypeScript major of the API and the frontend. Sibling checkouts resolve through
`collectors/workspace-paths.ts` (`resolveFrontendRoot`, `resolveSharedTypesRoot`
beside the API, interop, tests-live and training resolvers), and the shared
types collector reads the declaration files of the build the API installs, as
its `release-manifest.json` lists them. `npm run test:cross-repo` also runs
IQ-005, IQ-006 and IQ-008 on the real trees.

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

### PQ tied to the O-7 run (PQT-001 to PQT-006)

When the run's `run-summary.json` names the contract
`synthetic-trial.deviation-detection-summary/1` (in `contract`, `schema` or
`schemaVersion`; another contract in one of the others refuses the run), the run
is an O-7 deviation detection run on a public protocol (TA3 plan items O-7 and
VAL-1, spec P20 3.5). The import then reconstructs it through the CommandCenter
entry `synthetic-trial/surpass/deviations/reconstruct-detection.mjs` instead of
`synthetic-trial/evaluate/reconstruct.mjs` (a missing entry fails
BENCHMARK-RECONSTRUCTION with its path named), requires the summary to record
the SHA-256 of `metrics.json` under `artifacts`, and adds PQT-001 to PQT-006
after the two benchmark rows, derived from the reconstructed summary without
re-scoring (`derivePqtResults`). Every other run keeps exactly its two rows and
its entry. The cases are catalogued in `config/ta3-pq-cases.ts` and printed in
the PQ protocol (09), the validation summary (12) and the execution records (20):

| Case | Passes when | Outcome code otherwise |
| --- | --- | --- |
| PQT-001 | BENCHMARK-RECONSTRUCTION passed for the deviation run | `RECONSTRUCTION_FAILED` (PQT-002 to PQT-005 are then not executed) |
| PQT-002 | the gate `DEV-CRITICAL-EXPLAINED` in `gateGroups` is passed | `UNEXPLAINED_CRITICAL_MISS` |
| PQT-003 | `ruleClasses` reports each of the ten machine classes once, or states it not seedable with a reason | `CLASS_NOT_REPORTED` |
| PQT-004 | `manualRules` holds counts only, and no rule class is manual | `MANUAL_RULE_SCORED` |
| PQT-005 | `release.api` states the run's EDC API release (commit or image) | `RELEASE_NOT_RECORDED` |
| PQT-006 | a qualified person's adjudication record of the answer key exists | manual: never passes automatically |

What the import reads, strictly, in each case's part of the summary (a member,
value or shape outside this records `UNSUPPORTED_DEVIATION_SUMMARY` for that
case, never a guess). Beyond these, the import reads only what every import
reads (`evaluator`, `gateGroups`, `localEngineering`) and `artifacts`; other
top-level members, such as a label or a run id, are not read:

- `gateGroups[].gates[]`: `id` and `status` (the evaluator's gate statuses).
- `ruleClasses[]`: a reported class is `{class, status: "reported", seeded,
  detected, recall: {value, lower, upper, method: "wilson", confidence},
  precision: {matched, governed, value}}` with the optional `unmatched`,
  `critical` and `criticalMisses: [{code, count}]` (`code` one of the scorer's
  explanation codes, or null for an unexplained miss); a class the protocol
  states no requirement for is `{class, status: "not-seedable", reason}`. A
  reported class must have seeded at least one deviation, and its recall,
  interval, precision and unmatched count must agree with its counts.
- `manualRules`: `{specRules, manualReviewRequired}`.
- `release`: `api` (required for PQT-005 to pass), optional `ui`, `core` and
  `training` (commit, image or `none`), `il` (commit) and `csl` (release id).

PQT-005 is what the platform summary (document 22) compares with the OQ
package's release (`RELEASE_MISMATCH`); it never reads the OQ release itself.
The answer key of an O-7 run stays a draft, unadjudicated self-review until a
qualified person adjudicates it (D-10), so an O-7 import always lists PQT-006
among the cases not passed and the CLI exits nonzero. The PQ cases are synthetic
engineering evidence, not clinical accuracy, independent validation or SURPASS
attainment. `tests/pq-ta3.contract.test.ts` covers the dispatch and the
derivation with a synthetic summary (`tests/fixtures/deviation-detection-summary.synthetic.json`)
and a test stub of the CommandCenter entry; `npm run test:cross-repo` fails by
name until O-7/cc lands that entry and its scorer.

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
