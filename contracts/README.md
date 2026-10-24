# Validation framework contracts

Versioned JSON Schema (draft-07) contracts the validation framework produces or
reads (TA3 plan VAL-1, spec P20 3.3). Each file is the contract of record; the
framework validates its own inputs and outputs with hand-written strict
validators (unknown members refused) and a contract test checks that every
schema's `required` list equals its validator's required members. No schema
validator dependency is added.

| Contract | File | Owner and producer | Consumers |
| --- | --- | --- | --- |
| `validation-evidence-package/1` | `validation-evidence-package-v1.schema.json` | this framework, `runners/evidence-package.ts` (`sealPackage`) | `npm run verify:package`; the Intelligence Layer eTMF stores the filed `package-manifest.json` as an original without parsing it |
| `validation-target-configuration/1` | `validation-target-configuration-v1.schema.json` | owner: this framework, `runners/target-configuration.ts`; producer: the operator, later the CommandCenter harness | IQ-033 (`runners/iq-runner.ts`); `createPackage`, which retains it as `inputs/target-configuration.json`; `sealPackage` and `npm run verify:package` (`configurationUnderTest`) |
| `ta3-oq-plan/1` | `ta3-oq-plan-v1.schema.json` | owner: this framework, `runners/ta3-oq-plan.ts`; producer: the operator (VAL-1/validation-run step 0, every member read back from the stack) | the TA3 OQ suites 13 to 18 (`runners/oq-ta3-runner.ts`); `createPackage`, which retains it as `inputs/ta3-oq-plan.json` |
| `platform-validation-evidence-plan/1` | `platform-validation-evidence-plan-v1.schema.json` | owner: this framework, `runners/platform-evidence-plan.ts`; producer: the operator (the validation lead, VAL-1/validation-run step 3) | `checkPlatformEvidencePlan` (`runners/evidence-package.ts`) and the platform summary (`generators/22-platform-validation-summary.ts`); `createPackage`, which retains it as `inputs/platform-evidence-plan.json` |
| `platform-validation-summary/1` | `platform-validation-summary-v1.schema.json` | this framework, `generators/22-platform-validation-summary.ts` | CommandCenter W-5 readiness, when it is built (not yet) |

## Versioning

A contract version never changes meaning. A member may be added to a version
only while the producer and every consumer listed above live in this
repository and change together; otherwise a new version is published beside the
old one, and readers accept both before the producer emits the new one.
`validation-evidence-package/1` reserves the input roles of later VAL-1
subtasks; its `configurationUnderTest`, null before IQ-033, took its object form
with that case (no package with the null-only form had been retained).

## validation-target-configuration/1

The configuration under test of a run (`--target-config <file>`): the target
API base URL (the run's `--base-url`), the source file that sets the target's
environment with its SHA-256 (a compose file, whose `core-api` service
environment IQ-033 cross-checks, or an env file), who declared it and when, and
`flags`. Flag names come only from the allowlist (`ENABLE_DEVIATION_ENGINE`,
`ENABLE_DOMAIN_EVENTS`, `ENABLE_DEVIATION_DECISIONS`, `ENABLE_STUDY_TASK_CRON`,
`ESIG_ACKNOWLEDGEMENT_ENFORCED`, `ENABLE_M2M_API_KEYS`, `ENABLE_DATA_CLEANING`,
`INSPECTION_COPY_TA3_INVENTORY`, `ENABLE_SEGMENTED_INSPECTION_EXPORT`, `NODE_ENV`
and `TRAINING_SERVICE_URL`); booleans state the setting as the EDC reads it,
`NODE_ENV` is production, staging, development or test, and
`TRAINING_SERVICE_URL` is only `set` or `unset`. Any other member refuses the
file before anything runs, and a refusal names the member, never its value, so
no secret can enter a run or a package. In a sealed package,
`configurationUnderTest` holds the retained declaration's SHA-256 and flags and
every contradiction the run recorded (`{flag, declared, observed, observedBy}`):
IQ-033's source file cross-check, and the OQ cases that observe a flag at the
target (OQ-206 the engine, OQ-221 to OQ-224 the O-1 decision routes, OQ-241 and
OQ-242 the two W-1 inspection flags, recorded by `runners/oq-ta3-runner.ts`). An
observing case observed its flag off when it recorded `ENGINE_DISABLED` or
`FEATURE_DISABLED_AT_TARGET`, on when it passed, and the opposite of the
declaration when it recorded `CONFIGURATION_MISMATCH` itself. The package schema
refers to this schema's flags by its `$id`.

## validation-evidence-package/1

`package-manifest.json`, written last when a retained package is sealed. It
lists every other file of the package with its byte count and SHA-256, the
inputs the run copied in, the evidence counts per category, the framework
commit, the release under test and the target. `packageHash` is the SHA-256 of
the canonical JSON of the manifest without `packageHash` (object keys in the
default string order, UTF-16 code units, arrays in order, no whitespace). The
SHA-256 of the manifest file's own bytes is the `contentHash` the eTMF records
for the filed manifest, and the value `npm run verify:package` prints.

## ta3-oq-plan/1

The plan of the TA3 OQ suites 13 to 18 (`--ta3-oq-plan <file>`): the designated
armed synthetic study (`study.studyId`, the root that holds the armed spec, and
`study.siteStudyId`, the OQ site), the spec hash the receipts must carry, the
five synthetic named accounts (operator, reviewer, third person, blinded,
monitor), each as the names of the environment variables that hold its username
and password, the save-time rule (`saveRule`: rule, visit definition, form
version, item, violating and compliant values, visit date), the sweep's absence
rule and its anchor date, the optional follow-up study task and protocol version
fixture, and the bounds of the sweep and escalation waits with the escalation
recipient. `synthetic` is the literal `true`. Any other member, a literal secret
where a variable name belongs, or two accounts naming one username variable
refuses the file. Member names were finalised against the EDC routes:
`saveRule.item` became `itemId` (the form save keys values by `item_<itemId>`),
and `applicability` gained `earlyEnrollmentDate` and `lateEnrollmentDate`,
because a visit's planned target date runs from the subject's Day 1.

## platform-validation-evidence-plan/1

The evidence the platform summary admits (`--platform-evidence <file>`), per
system of the platform inventory (`config/platform-inventory.ts`): who prepared
the plan and, under `systems.<id>.evidence`, each entry's `kind`, absolute
`path`, `sha256` and `synthetic`, with an optional `note`. Evidence is admitted
only by hash. A `validation-evidence-package/1` entry names a sealed package of
this framework (its directory or its `package-manifest.json`) by the SHA-256 of
`package-manifest.json`, the value `npm run verify:package` prints, and is
verified with `verifyPackage`; its `synthetic` must equal the manifest's. Any
other kind names a file by its own SHA-256 and is admitted by hash only; its
`synthetic` is the preparer's declaration. Each system admits what its
inventory entry names: a package (for the Intelligence Layer only one holding
`p13` evidence, for the Command Center only one holding `benchmark` evidence),
files by hash, both, or nothing. A system the inventory lacks, an entry the
system does not admit, a synthetic declaration that differs from the cited
manifest, or a package without its system's category refuses the plan before
anything runs; a hash that does not match is shown in the summary as
`mismatch`, and a file or package that cannot be read as `unreadable`. Any
synthetic entry makes the documents package synthetic (`syntheticBasis`
`platform-evidence-plan`).

## platform-validation-summary/1

`platform-validation-summary.json`, written beside
`22-platform-validation-summary.md`. For each of the fourteen systems: its
repository path under the platform root, HEAD and whether tracked files differ
(read with `git rev-parse` and `git status`, never written), its TA3 uses, the
line that states its qualification status quoted exactly from the current
bytes with the file's SHA-256 and line number (`not-found` when the inventory
is stale, `not-stated` when the repository states none), the evidence the plan
cites with each entry's status (`verified`, `hash-only`, `mismatch`,
`unreadable`), and its gaps with the plan item and the probe result (`open`,
`probe-not-matched`, `file-missing`, or null for a stated gap). A system's
status is `evidence-present-unapproved` when an admitted entry verified or
matched by hash, else `gap`; it is never "qualified", and approval is recorded
in the eTMF. `releaseConsistency` compares the EDC API release of each cited
OQ package with the release each cited O-7 import recorded in PQT-005
(`responseBody.release.api`): `same`, `RELEASE_MISMATCH` (also a gap of
`edc-api`) or `not-comparable`. `pendingValidatedChanges` lists the D-04 change
with the production profile lines of its settings, the OQ cases it needs, how
many of them passed in each cited OQ package, the SOP-CC-001 category row and
the status `no-change-control-record`. A synthetic or development run adds
`synthetic`, `syntheticNotice` or `retention`, as evidence summaries do. The
summary holds no subject, site or arm data.

## Read, not owned: synthetic-trial.deviation-detection-summary/1

The summary contract of the CommandCenter O-7 deviation detection runs (spec
P09 8.2). CommandCenter owns and produces it, so this framework publishes no
schema for it. The benchmark import (`runners/benchmark-evidence.ts`) reads it
only to derive PQT-001 to PQT-006 from a reconstructed run, never re-scoring:
the members it reads and how strictly are listed in the main README, section
"PQ tied to the O-7 run". When CommandCenter publishes a schema for this
contract, that schema is the reference and the reader follows it.
