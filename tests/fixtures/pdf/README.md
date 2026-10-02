# Fictional PDF parser fixtures

These small, one-page PDFs exercise the qualification runner's real PDF parser
and field/value/unit matching. They contain fictional software-test data. They
are not native application exports, participant records, verified signatures,
or clinical or regulatory validation evidence.

- `owned-form.pdf`: unsigned fictional form with the owned subject, weight,
  notes, zero, false, Unicode, units, and a fictional audit row.
- `signed-form.pdf`: the same form with a fictional signature manifestation.
  Its 64-character `a` hash is an explicit test value, not a computed proof.
- `empty-text.pdf`: a structurally valid, intentionally blank PDF. The parser
  must refuse it as readable evidence.

`generate.py` creates all three using ReportLab 4.4.9, its invariant output mode,
and uncompressed streams. Equal-length text substitutions such as `70.5` to
`71.5` preserve object offsets, enabling parseable wrong-content tests. Tests use
the committed PDFs; Python and ReportLab are needed only to regenerate them.

From the repository root, run the generator with the bundled Python runtime:

```powershell
& "$env:USERPROFILE/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe" tests/fixtures/pdf/generate.py
node --require ts-node/register --test tests/pdf-evidence.contract.test.ts
```

The generator embeds the bundled DejaVuSans font. Set `PDF_FIXTURE_FONT` to its
path on another installation. The generation font SHA-256 is
`7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954`.

Generated fixture SHA-256 values:

- `owned-form.pdf`: `f0320bb33bfcc6e83f5242d002ffc54947d0dc4a3769ccd919d8d40bf71686d6`
- `signed-form.pdf`: `4b0b907643709a25dbffc43a6f7131bbdf869271acf25cf546357aae7de5059f`
- `empty-text.pdf`: `abdcfaaf2df1970a164f6d34f70963c68b25df8c55d3fadb2853fe53f60b8acc`

On 2026-10-02, Poppler rendered every page at a 1400-pixel longest edge. All
three pages were visually inspected: the two forms retain readable, unclipped
text and the blank fixture remains blank. Independent pypdf extraction confirms
one page each and the expected Unicode text. The actual runner parser contracts
passed 26/26 with no skips. Retained renderings, extraction, and the TAP log are
in `C:/Projects/.synthetic-trial-data/staging/realism-20261002/qualification-pdf-fixtures-v1/`.

The PDF artifact marker was recorded once before generation with an initial
expected count of two. The parent task subsequently requested the signed-form
variant, extending this same authoring operation to three fixtures; the marker
was not rerun.
