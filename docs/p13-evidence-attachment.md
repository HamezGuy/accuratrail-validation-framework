# Protocol evaluation evidence and SURPASS scope

The CommandCenter clinical operations benchmark and IL P13 protocol evaluation
have different denominators. Reuse each authoritative evaluator. Do not merge
their percentages, translate absent results to zero errors, or award extraction
credit for document custody.

## Existing implementation boundaries

CommandCenter's `synthetic-trial/load/il/il-client.mjs` explicitly refuses model,
pipeline, and P13 execution routes. That synthetic leg retains original documents
and audit evidence; extraction is `not_run`. `--benchmark-run` preserves this
scope and only attaches reconstructable synthetic engineering results.

IL's `EDCProtocolToECRF` already implements P13 parser/extraction metrics,
one-to-one gold matching, typed dose/operator/negation fidelity, scenario-bound
evidence, locked corpus versions, amendment scenarios, replay, and regression
analysis. Source locations:

- `apps/api/src/internal/group-f/p13/p13-evaluation.controller.ts`
- `packages/application/src/group-f/p13-evaluation/metrics/measurement-contract.ts`
- `packages/application/src/group-f/p13-evaluation/metrics/extraction-metrics.ts`
- `packages/application/src/group-f/p13-evaluation/orchestrator/benchmark-orchestrator.ts`
- `packages/domain/src/group-f/p13-evaluation/models/gold-corpus.ts`

## Required attachment for an extraction claim

An independently executed IL evaluation must retain its own native evidence:

1. The locked corpus version and source hashes; case/scenario/document-version
   identities and admitted/excluded partitions; annotation/adjudication history.
2. `GET /internal/p13/metrics/contracts` and `GET /internal/p13/benchmark/contracts`
   from the evaluated release, including measurement implementation hashes,
   threshold policy hashes, and supported runner versions. These are the routes
   under the current `internal/p13` controller prefix; retain deployment API
   prefixes and existing access controls when collecting them.
3. The submitted and completed benchmark record, its actual/gold evidence refs,
   terminal evidence, repository/image revisions, model/provider configuration,
   source snapshots, exact run times, and run costs where measured.
4. Native metric numerators/denominators, failures, vacuous/unmeasured states,
   stratification, and the original immutable report. The native
   `benchmark/records/:id` path verifies terminal evidence on retrieval; a
   pasted `status: completed` or exported aggregate alone is insufficient.
5. Separate independent-review evidence before describing the evaluation as
   independent. A locked corpus, generated synthetic labels, an internal
   reviewer ID, or a hash proves neither clinical adequacy nor independence.

Store this package as a linked supplemental artifact with its own evidence level
and scope. The current qualification importer deliberately does not automatically
accept arbitrary P13 JSON as qualification success. A future executable P13
attachment adapter must verify native evidence and hashes, authorization and
tenant/study scope, frozen pre-run identity, completed execution, and denominator
coverage; test missing/tampered/wrong-scope/vacuous results before enabling it.
No new product, model, or paid run is triggered by this documentation.

## What remains an external validation task

Obtain legally permitted historical study data and processing/model-use terms;
freeze a study-level evaluation protocol and holdout answer key with qualified
independent reviewers; collect a comparable human baseline and human touch time;
have an appropriate statistician define uncertainty analysis and trial-modeling
endpoints. Synthetic engineering results cannot substitute for those inputs.
