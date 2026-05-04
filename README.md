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
- **templates/** — Editable document header/footer templates

## Updating

1. Edit `config/system-info.ts` with new version info before each release
2. Edit `config/regulatory-scope.ts` if regulatory scope changes
3. Edit `config/risk-ratings.ts` to adjust risk levels
4. Re-run `npm run generate:all` to regenerate the full package
