import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  E6_R3_REFERENCES, E6_R3_SECTION_STATUS, ICH_E6_R3, REGULATORY_SCOPE, e6r3, type E6R3Key,
} from '../config/regulatory-scope';
import { generateAllDocuments, temporaryDirectory } from './generated-documents';

const root = path.resolve(__dirname, '..');
// The superseded revision, built from parts so that this file never contains it.
const SUPERSEDED = new RegExp(`E6\\s?\\(R${2}\\)`, 'i');
const STATUS_ROW = `| ${ICH_E6_R3.citation} Section References | ${E6_R3_SECTION_STATUS} |`;

function trackedFiles(): string[] {
  return execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', windowsHide: true })
    .split('\0').filter(Boolean);
}

test('no tracked file outside vendor/ cites the superseded ICH E6 revision', () => {
  const files = trackedFiles().filter(file => !file.startsWith('vendor/'));
  assert.ok(files.length > 50, 'git lists the tracked files');
  const offenders = files.filter(file => {
    const full = path.join(root, file);
    return fs.existsSync(full) && SUPERSEDED.test(fs.readFileSync(full, 'utf8'));
  });
  assert.deepEqual(offenders, []);
});

test('a documents-only generation cites ICH E6(R3) only and states the verification status in every document', t => {
  const documents = generateAllDocuments(temporaryDirectory(t, 'accura-e6r3-'));
  assert.ok(documents.size >= 21, `${documents.size} documents generated`);
  for (const [name, content] of documents) {
    assert.doesNotMatch(content, SUPERSEDED, name);
    assert.ok(content.includes(STATUS_ROW), `${name} states the E6(R3) verification status`);
  }
  const plan = documents.get('02-validation-plan.md')!;
  for (const key of Object.keys(E6_R3_REFERENCES) as E6R3Key[]) {
    const row = plan.split('\n').find(line => line.startsWith(`| \`${key}\` |`));
    assert.ok(row, `the validation plan lists ${key}`);
    assert.ok(row.includes(E6_R3_REFERENCES[key].topic) && row.includes(e6r3(key)) && row.includes(E6_R3_SECTION_STATUS), row);
  }
  const urs = documents.get('03-user-requirements-spec.md')!;
  for (const key of ['auditTrails', 'signatures', 'dataCapture', 'protocolAndRecords', 'dataCorrections'] as const) {
    assert.ok(urs.includes(e6r3(key)), `the URS cites ${key}`);
  }
  const applicability = documents.get('01-applicability-assessment.md')!;
  assert.match(applicability, /\| ICH E6\(R3\) \| Guideline for Good Clinical Practice, Principles and Annex 1 \(ICH Step 4, 6 January 2025\) \|/);
  assert.match(applicability, /Protocol Deviations for Clinical Investigations of Drugs, Biological Products, and Devices/);
});

test('every ICH E6(R3) key the source cites is in the one mapping', () => {
  const used = new Set<string>();
  for (const file of trackedFiles().filter(name => name.endsWith('.ts'))) {
    for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/\be6r3\(\s*'([^']*)'\s*\)/g)) used.add(match[1]);
  }
  assert.ok(used.size >= 8, `${used.size} mapped keys cited`);
  const mapped = Object.keys(E6_R3_REFERENCES);
  for (const key of used) assert.ok(mapped.includes(key), `${key} is mapped`);
  assert.throws(() => e6r3('superseded' as E6R3Key), /No ICH E6\(R3\) reference is mapped/);
});

test('the mapping stays pending QA verification and the predicate rules cite it beside the FDA deviation guidance', () => {
  assert.equal(ICH_E6_R3.sectionVerification, 'pending-qa');
  for (const [key, reference] of Object.entries(E6_R3_REFERENCES)) {
    assert.ok(reference.topic.trim() && reference.section.trim(), key);
    assert.equal(e6r3(key as E6R3Key), `ICH E6(R3) ${reference.section}`);
  }
  const rules = REGULATORY_SCOPE.predicateRules;
  assert.equal(rules.filter(rule => rule.citation === ICH_E6_R3.citation).length, 1);
  assert.ok(rules.some(rule => rule.citation === 'FDA draft guidance (December 2024)'
    && rule.title === 'Protocol Deviations for Clinical Investigations of Drugs, Biological Products, and Devices'));
});
