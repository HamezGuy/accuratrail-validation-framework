# Retained EDC bytes from the K6b synthetic platform-arms run

SYNTHETIC ENGINEERING EVIDENCE. Synthetic data on a test stack. Not a real trial, not an approval.

Byte-for-byte copies of two documents the EDC API retained during the synthetic K6b run
`k6b-platform-arms-20261022T020633Z` (study `AT-SYN-PROBE-K6B`, project `at-syn-k6`; its `run.json` records
commit `a722835a73a8d88d0201e4e9bc945cec5b83d64a` and the core API image `edcproject-core-api:synthetic-a722835`).
They were read through the routes OQ-233 and OQ-234 exercise (`GET /api/sites/study/:studyId/milestone-measurements/:id`
and `GET /api/sites/study/:studyId/effort-ledger/:id`) by an account with the per-study unblinded role, so both
carry `armGrouping: "included"`. The actors are the run's synthetic accounts (`syn_admin`, `syn_dm`, `syn_crc_101`
and so on); the milestone references say SYNTHETIC.

| File | Source | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `milestone-measurement.exact.json` | `C:/Projects/.synthetic-trial-data/runs/k6b-platform-arms-20261022T020633Z/milestone-measurement.exact.json` | 21540 | `a73022c09f8250d7d5fa054ed4621e3610ba8bfd114a1c3897bee852333e2047` |
| `effort-ledger.exact.json` | `C:/Projects/.synthetic-trial-data/runs/k6b-platform-arms-20261022T020633Z/effort-ledger.exact.json` | 56057 | `d8e3b1901321b14734cfe898204fd6888d8740955c7be9861ac9b2f1005b9dbe` |

`tests/ta3-oq.contract.test.ts` checks that both files still hash to these values (spec P20 fact F-h), that
they pass the retained-document checks of OQ-233 and OQ-234, and that `armGroupedContent` finds their
arm-grouped content, which OQ-236 requires a blinded reader never to receive. `.gitattributes` keeps them
byte for byte (`tests/fixtures/edc-k6b/** -text`). Do not edit them: replace both with a newer retained pair
and update this table.
