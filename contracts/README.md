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

## Versioning

A contract version never changes meaning. A member may be added to a version
only while the producer and every consumer listed above live in this
repository and change together; otherwise a new version is published beside the
old one, and readers accept both before the producer emits the new one.
`validation-evidence-package/1` reserves `configurationUnderTest` (null until
IQ-033 records the declared configuration) and the input roles of later VAL-1
subtasks.

## validation-evidence-package/1

`package-manifest.json`, written last when a retained package is sealed. It
lists every other file of the package with its byte count and SHA-256, the
inputs the run copied in, the evidence counts per category, the framework
commit, the release under test and the target. `packageHash` is the SHA-256 of
the canonical JSON of the manifest without `packageHash` (object keys in the
default string order, UTF-16 code units, arrays in order, no whitespace). The
SHA-256 of the manifest file's own bytes is the `contentHash` the eTMF records
for the filed manifest, and the value `npm run verify:package` prints.
