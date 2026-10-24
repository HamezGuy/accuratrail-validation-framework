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
OQ-242 the two W-1 inspection flags, once VAL-1/validation-oq lands them). An
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
