# Synthetic USDM qualification fixture

Exact copies from the API repository's tests/fixtures/synthetic-usdm4-core, supplied by Gibbs on 2026-09-09. No fixture bytes were edited or truncated. This is synthetic observational data (CT No Intervention), not a real study. SHA256 receipts are in ../../docs/usdm-study-migration/evidence/verification.json.

The source evidence reports the pinned full 207 CORE rules: 162 applicable, 45 not applicable, zero findings/errors/warnings and conformant=true. This client task did not rerun CORE. The full report remains in the API repository as iteration-2-core-report.json (SHA256 56cc2e3f0367a92572f7ad56b32d5ed67585850c8a03640e585308328d115ade). The compact evidence, shared validation result and coding evidence are copied beside the fixture. Shared-only validation correctly does not grant releaseReady without an actual CORE report.

qualification-fixture.ts verifies the document and envelope hashes before use. Only execution.identification.nativeIdentifier is replaced with the locally owned test fixture identifier; the entire USDM document and selection are preserved. A fixture's prior conformance evidence never replaces current server validation, release signatures, application or activation checks.
