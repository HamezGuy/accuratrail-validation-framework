import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import Module from 'node:module';
import { parsePdfEvidence, requirePrintedRow } from '../runners/pdf-evidence';

const fixture = (name: string): Buffer => readFileSync(path.join(__dirname, 'fixtures', 'pdf', name));
const ownedPdf = fixture('owned-form.pdf');
// Share one real parser invocation; every row assertion still uses extracted PDF text.
const owned = parsePdfEvidence(ownedPdf);

test('real PDF bytes parse to the exact fictional subject, field content, and one page', async () => {
  const result = await owned;
  assert.equal(result.pages, 1);
  assert.match(result.text, /Subject: OQ-OWNED-SUBJECT/);
  assert.match(result.text, /Synthetic software qualification only/);
  assert.match(result.text, /Electronic signature/);
  assert.match(result.text, /Fictional parser qualification fixture\./);
  assert.match(result.text, /Signature state: unsigned/);
  assert.match(result.text, /Fictional manifestation only; no signature authority is asserted/);
  assert.match(result.text, /Café naïve/);
  assert.match(result.text, /μg/);
});

test('a parser process failure cannot become success even after it sends text', async t => {
  const realSpawn = childProcess.spawn;
  t.mock.method(childProcess, 'spawn', (executable: string, _args: readonly string[], options: childProcess.SpawnOptions) => realSpawn(executable,
    ['-e', "process.once('message', () => { process.send({result:{pages:1,text:'False success'}}, () => process.exit(87)); });"], options));
  await assert.rejects(parsePdfEvidence(ownedPdf), /PDF parsing process failed \(87\)/);
});

test('missing parser dependencies fail before any process is spawned', async t => {
  const loader = Module as unknown as { _resolveFilename: (...args: any[]) => string };
  const original = loader._resolveFilename;
  t.mock.method(loader, '_resolveFilename', function(this: unknown, ...args: any[]) {
    if (args[0] === 'pdfjs-dist/legacy/build/pdf.mjs') throw new Error('Parser dependency unavailable');
    return original.apply(this, args);
  });
  const spawned = t.mock.method(childProcess, 'spawn', () => { throw new Error('Must not spawn'); });
  await assert.rejects(parsePdfEvidence(ownedPdf), /Parser dependency unavailable/);
  assert.equal(spawned.mock.callCount(), 0);
});

for (const result of [{ pages: 1, text: 42 }, { pages: 0, text: 'text' }, { pages: 201, text: 'text' }])
test(`malformed parser IPC cannot escape as a controller exception: ${JSON.stringify(result)}`, async t => {
  const realSpawn = childProcess.spawn;
  t.mock.method(childProcess, 'spawn', (executable: string, _args: readonly string[], options: childProcess.SpawnOptions) => realSpawn(executable,
    ['-e', `process.once('message', () => { process.send(${JSON.stringify({ result })}, () => process.disconnect()); });`], options));
  await assert.rejects(parsePdfEvidence(ownedPdf), /malformed parser result/);
});

test('successive real PDFs leave the qualification controller alive', async () => {
  for (const name of ['owned-form.pdf', 'signed-form.pdf', 'owned-form.pdf', 'signed-form.pdf']) {
    const result = await parsePdfEvidence(fixture(name));
    assert.equal(result.pages, 1);
    requirePrintedRow(result.text, ['Weight', '70.5', 'kg'], 'the unchanged weight across parser processes');
  }
});

test('a hung parser reaches its deadline and its owned process is confirmed closed', async t => {
  const realSpawn = childProcess.spawn;
  let closed = false;
  t.mock.method(childProcess, 'spawn', (executable: string, _args: readonly string[], options: childProcess.SpawnOptions) => {
    const child = realSpawn(executable, ['-e', "process.once('message', () => { setInterval(() => {}, 1000); });"], options);
    child.once('close', () => { closed = true; });
    return child;
  });
  await assert.rejects(parsePdfEvidence(ownedPdf), /PDF parsing exceeded its 15-second deadline/);
  assert.equal(closed, true, 'Deadline failure must retain cleanup custody until the exact child closes.');
});

test('signed fictional PDF retains the full manifestation and audit content', async () => {
  const result = await parsePdfEvidence(fixture('signed-form.pdf'));
  assert.equal(result.pages, 1);
  for (const cells of [
    ['Electronic signature - form', '111'],
    ['Signer:', 'Owned Operator (operator)'],
    ['Signed at:', '2026-10-02T12:00:00.000Z'],
    ['Meaning:', 'Approved'],
    ['Signature record:', '901'],
    ['SHA-256:', 'a'.repeat(64)],
    ['Verified scope:', 'event-crf-item-values/1'],
    ['Weight', 'Owned Operator', '75', '70.5', 'PQ verified synthetic weight correction'],
  ]) requirePrintedRow(result.text, cells, `fictional signed content ${cells[0]}`);
  assert.doesNotMatch(result.text, /Signature state: unsigned/);
});

test('unsigned fictional PDF retains audit headings and exact correction reason', async () => {
  const { text } = await owned;
  requirePrintedRow(text, ['Form audit history', 'Audit Trail Report'], 'audit headings');
  requirePrintedRow(text, ['Date/Time', 'Action', 'Field', 'User', 'Old Value', 'New Value', 'Reason'], 'audit column headings');
  requirePrintedRow(text, ['Weight', 'Owned Operator', '75', '70.5', 'PQ verified synthetic weight correction'], 'audit correction row');
});

test('same-length altered field bytes remain a parseable PDF but fail the original value contract', async () => {
  const original = ownedPdf.toString('latin1');
  assert.ok(original.includes('70.5'), 'the fixture must retain uncompressed field text');
  const changed = Buffer.from(original.replace(/70\.5/g, '71.5'), 'latin1');
  assert.equal(changed.length, ownedPdf.length);
  assert.notDeepEqual(changed, ownedPdf);
  const result = await parsePdfEvidence(changed);
  assert.equal(result.pages, 1);
  requirePrintedRow(result.text, ['Weight', '71.5', 'kg'], 'altered weight');
  assert.throws(() => requirePrintedRow(result.text, ['Weight', '70.5', 'kg'], 'original weight'), /PDF does not preserve/);
});

test('PDF-looking prefix and EOF garbage cannot substitute for a parseable document', async () => {
  const garbage = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(3000, 129), Buffer.from('\n%%EOF\n')]);
  await assert.rejects(parsePdfEvidence(garbage));
});

test('a structurally valid but empty PDF cannot satisfy readable evidence', async () => {
  await assert.rejects(parsePdfEvidence(fixture('empty-text.pdf')), /no readable text/);
});

test('truncated real PDF and JSON substitutions are refused', async () => {
  await assert.rejects(parsePdfEvidence(ownedPdf.subarray(0, Math.floor(ownedPdf.length / 2))));
  await assert.rejects(parsePdfEvidence(Buffer.from('{"success":true,"text":"Weight 70.5 kg"}')));
});

for (const [label, cells] of [
  ['subject identity', ['Subject:', 'OQ-OWNED-SUBJECT']],
  ['weight and unit', ['Weight', '70.5', 'kg']],
  ['owned notes', ['Notes', 'Synthetic software qualification only']],
  ['zero value', ['Count', '0']],
  ['false value', ['Confirmed', 'false']],
  ['degree unit', ['Temperature', '37.2', '°C']],
  ['Unicode microgram unit', ['Dose', '0', 'μg']],
  ['Unicode canonical normalization', ['Unicode label', 'Cafe\u0301 nai\u0308ve']],
  ['literal regular-expression metacharacters', ['Regular expression [test]', '1.0 (checked)']],
] as const) test(`printed row preserves ${label}`, async () => {
  requirePrintedRow((await owned).text, [...cells], label);
});

test('row matching normalizes repeated whitespace without losing zero, false or units', async () => {
  const text = (await owned).text.replace(/ /g, '\t \n  ');
  requirePrintedRow(text, ['Weight', ' 70.5 ', 'kg'], 'weight after whitespace normalization');
  requirePrintedRow(text, ['Count', '0'], 'zero after whitespace normalization');
  requirePrintedRow(text, ['Confirmed', 'false'], 'false after whitespace normalization');
});

for (const [label, cells] of [
  ['swapped field values', ['Weight', '37.2', 'kg']],
  ['unrelated numeric value elsewhere in the PDF', ['Count', '70.5']],
  ['a missing label', ['Body weight', '70.5', 'kg']],
  ['a wrong unit', ['Weight', '70.5', 'lb']],
  ['a missing requested unit', ['Count', '0', 'kg']],
  ['a numeric prefix of a different value', ['Weight', '70', 'kg']],
  ['false replaced by a different value', ['Confirmed', 'true']],
  ['a different subject', ['Subject:', 'OQ-FOREIGN-SUBJECT']],
] as const) test(`printed row refuses ${label}`, async () => {
  const text = (await owned).text;
  assert.throws(() => requirePrintedRow(text, [...cells], label), /PDF does not preserve/);
});

test('empty labels/cells cannot turn any document into passing row evidence', async () => {
  const { text } = await owned;
  for (const cells of [[], [''], ['  ', '70.5'], ['Weight', '']]) {
    assert.throws(() => requirePrintedRow(text, cells, 'empty row contract'), /PDF does not preserve/);
  }
});
