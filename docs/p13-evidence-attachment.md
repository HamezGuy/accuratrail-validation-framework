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

## Executable read-only attachment

Use the existing qualification collector with an explicit attachment plan:

```powershell
npm run generate -- --p13-plan C:/qualification/p13-plan.json --version p13-qualified-run-001
```

Supply an authorized scoped admin bearer through the environment variable named
by the plan. The collector never mints a token, signs in, executes a benchmark,
invokes a model, follows a redirect, or changes CommandCenter's IL route guard.
It calls exactly the two contract GETs above and
`GET /internal/p13/benchmark/records/:id`, with `x-tenant-id` and `x-study-id`.
The server's verified tenant and study contexts remain authoritative; the returned
record must independently match both expected identities. Each read is limited to
30 seconds and 16 MiB. An absent record, refusal, malformed/oversized response or
contract mismatch fails; the importer does not fall back to an uploaded report.

The JSON plan has exactly these top-level keys:

- `contract`: `p13-qualification-attachment/1`.
- `apiBaseUrl`: the actual API prefix, such as `http://127.0.0.1:3001/api`.
  Userinfo, query strings and fragments are refused. Nonlocal targets require
  HTTPS plus the separate CLI flag `--allow-production-qualification`.
- `bearerTokenEnv`: an environment variable name, never the bearer value.
- `expected`: `benchmark_run_id`, `tenant_id`, `study_id`,
  `system_version_bundle_id`, `corpus_commit_hash`, `execution_request`,
  `metric_definition_versions`, `threshold_policy_versions`, `metrics_contract`,
  and `benchmark_contract`.
- `measurements`: an array of exact expected measurement pairs. Each has
  `identity`, `actual_ref`, `gold_ref`, `metric_definition_ref`,
  `threshold_policy_ref`, and a nonempty `metric_ids` array. Identity carries
  `case_id`, `scenario_id`, `document_version_id`, `measurement_family`,
  `category` and `document_kind`. Preserve the opaque native metric IDs exactly.

Take the accepted `execution_request` and run identities from the native record;
retain its original acceptance evidence. Preserve the two full native contract
snapshots under `metrics_contract` and `benchmark_contract`. Pin the measurement
pairs and metric census from the authorized evaluation protocol and installed
native measurement contract; do not trim them to make a result pass. These
operator-supplied expected identities are checked, but their presence alone does
not prove preregistration, independent gold adjudication or complete clinical
coverage. Current supported versions are execution/scenario `/1` and identity
measurement `/3`. Future contracts require an adapter review.

Evidence is create-only under `evidence/p13/`; use a new qualification version
for each attempt. The raw input plan hash (`inputPlanSha256`) and separately
hashed sanitized plan (`retainedPlanSha256`), collector source hashes, three scoped
HTTP exchanges, native record, terminal/scenario references, original metrics
and mismatch details remain available. Local artifact hashes identify the
retained JSON representation, not original wire bytes or the deployed image.
Tokens are removed from the retained plan and results; their sanitized bytes
need not equal the original input bytes. Keep plan/source documents free of
credentials and preserve the native corpus, CAS objects and release identity
separately; this endpoint does not export the complete CAS or model manifest.

`P13-NATIVE-ATTACHMENT` checks native retrieval and the exact expected scenario
and metric census. `P13-NATIVE-METRICS` separately reflects the native completed
run and original successful metric statuses. Missing measurements yield
`not_run`; failed, regressed, no-baseline and vacuous rows cannot pass. Replay or
amendment scenarios with no metrics retain their evidence but earn no extraction
credit. Extraction candidate/gold and typed counts are retained. Parser results
currently do not expose those denominator counts; the attachment explicitly
records `not_exposed_by_native_contract` and never supplies invented counts.

The native record GET verifies the terminal CAS hash and bound scenario results.
The adapter does **not** independently re-score the metrics or establish that
the source bytes behind every referenced object are present in the exported
qualification directory. Qualification of that native authority and independent
clinical evaluation remain separate. `--docs-only` makes no P13 requests;
offline mocked-controller checks are in `npm run test:benchmark`.

## What remains an external validation task

Obtain legally permitted historical study data and processing/model-use terms;
freeze a study-level evaluation protocol and holdout answer key with qualified
independent reviewers; collect a comparable human baseline and human touch time;
have an appropriate statistician define uncertainty analysis and trial-modeling
endpoints. Synthetic engineering results cannot substitute for those inputs.
