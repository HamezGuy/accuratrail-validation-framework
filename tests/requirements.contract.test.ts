import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { E6_R3_REFERENCES, REGULATORY_SCOPE, e6r3 } from '../config/regulatory-scope';
import { TA3_REQUIREMENTS, ta3RequirementCases } from '../config/ta3-requirements';
import { TA3_OQ_CASES } from '../config/ta3-oq-cases';
import { runnerCaseCheck } from '../generators/helpers/evidence-linker';
import { generate as generateApplicability } from '../generators/01-applicability-assessment';
import { generate as generateUrs } from '../generators/03-user-requirements-spec';
import { generate as generateFrs } from '../generators/04-functional-requirements-spec';
import { temporaryDirectory } from './generated-documents';

/** The TA3 requirements, records and mappings of TA3 plan item VAL-1 (spec P20 3.6). */

const ids = (prefix: string, first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, index) => `${prefix}-${String(first + index).padStart(3, '0')}`);
// An en or em dash, written as escapes so that this file holds neither.
const DASH = /[\u2013\u2014]/;
const RISK_RANK = { Low: 0, Medium: 1, High: 2, Critical: 3 } as const;

function generated(directory: string, file: string): string {
  return fs.readFileSync(path.join(directory, file), 'utf8');
}

/** The cells of every table row whose first cell starts with the prefix. */
function rows(content: string, prefix: string): string[][] {
  return content.split('\n').filter(line => line.startsWith(`| ${prefix}`)).map(line => line.slice(2, -2).split(' | '));
}

test('the regulated records run from REC-001 to REC-028 without a gap, the TA3 records kept for 15 years', () => {
  const records = REGULATORY_SCOPE.regulatedRecords;
  assert.deepEqual(records.map(record => record.id), ids('REC', 1, 28));
  const ta3 = records.slice(15);
  for (const record of ta3) {
    assert.equal(record.regulated, true, record.id);
    assert.equal(record.retentionYears, 15, record.id);
    assert.ok(record.name.trim() && record.description.trim(), record.id);
    assert.doesNotMatch(`${record.name} ${record.description}`, DASH, record.id);
  }
  assert.deepEqual(Object.fromEntries(ta3.map(record => [record.id, record.dataClassification])), {
    'REC-016': 'clinical', 'REC-017': 'clinical', 'REC-018': 'clinical', 'REC-019': 'clinical', 'REC-020': 'clinical',
    'REC-021': 'clinical', 'REC-022': 'administrative', 'REC-023': 'administrative', 'REC-024': 'ePHI', 'REC-025': 'ePHI',
    'REC-026': 'clinical', 'REC-027': 'ePHI', 'REC-028': 'system',
  });
  // O-2 has landed, so the escalation record names its tables, not a placeholder.
  assert.match(records.find(record => record.id === 'REC-021')!.description, /acc_deviation_escalation_policy_event/);
});

test('URS-081 to URS-101 each have one functional requirement, FRS-087 to FRS-107', () => {
  assert.deepEqual(TA3_REQUIREMENTS.map(requirement => requirement.id), ids('URS', 81, 101));
  assert.deepEqual(TA3_REQUIREMENTS.map(requirement => requirement.frs.id), ids('FRS', 87, 107));
  for (const requirement of TA3_REQUIREMENTS) {
    assert.match(requirement.description, / SHALL /, requirement.id);
    assert.ok(requirement.title && requirement.acceptance && requirement.rationale && requirement.context, requirement.id);
    assert.ok(requirement.frs.requirement.trim() && requirement.frs.implementation.trim(), requirement.frs.id);
    assert.match(requirement.part11Ref, /^11\.\d+(\([a-z]\))?(, 11\.\d+(\([a-z]\))?)*$/, requirement.id);
    assert.ok(requirement.e6r3.length > 0 && requirement.e6r3.every(key => key in E6_R3_REFERENCES), requirement.id);
  }
  // No en or em dash in any text the documents print from the data.
  assert.doesNotMatch(JSON.stringify(TA3_REQUIREMENTS), DASH);
});

test('every case a TA3 requirement cites is a catalogued runner case, and each TA3 OQ case is cited by the requirement its catalog entry names', () => {
  for (const requirement of TA3_REQUIREMENTS) {
    assert.ok(requirement.planned.length > 0, requirement.id);
    for (const item of requirement.planned) {
      assert.ok(item.activity.trim(), requirement.id);
      // A gap always says why no executed case is mapped.
      if (!item.cases.length) assert.ok(item.note?.trim(), `${requirement.id}: ${item.activity}`);
    }
    for (const id of ta3RequirementCases(requirement)) {
      assert.ok(runnerCaseCheck(id).check.length > 40, `${requirement.id} cites ${id}`);
      // A requirement is rated at least as high as any TA3 case it cites.
      const entry = TA3_OQ_CASES.find(candidate => candidate.id === id);
      if (entry) assert.ok(RISK_RANK[requirement.risk] >= RISK_RANK[entry.riskLevel], `${requirement.id} against ${id}`);
    }
  }
  for (const entry of TA3_OQ_CASES) {
    const owner = TA3_REQUIREMENTS.find(requirement => requirement.id === entry.requirement);
    assert.ok(owner, `${entry.id} names ${entry.requirement}`);
    assert.ok(ta3RequirementCases(owner).includes(entry.id), `${entry.requirement} cites ${entry.id}`);
  }
  // The requirements no runner case verifies are stated gaps, never a cited case.
  assert.deepEqual(TA3_REQUIREMENTS.filter(requirement => !ta3RequirementCases(requirement).length).map(requirement => requirement.id),
    ['URS-099', 'URS-100', 'URS-101']);
});

test('the generated URS and FRS carry the TA3 requirements, their ICH E6(R3) references and the cases that verify them', t => {
  const directory = temporaryDirectory(t, 'accura-requirements-');
  generateUrs(directory, directory);
  generateFrs(directory, directory);
  generateApplicability(directory, directory);
  const urs = generated(directory, '03-user-requirements-spec.md');
  const frs = generated(directory, '04-functional-requirements-spec.md');

  assert.match(urs, /^## TA3 Platform Operations$/m);
  assert.match(urs, /\*\*Total Requirements:\*\* 101/);
  const ursRows = rows(urs, 'URS-');
  for (const requirement of TA3_REQUIREMENTS) {
    const table = ursRows.find(cells => cells[0] === requirement.id && cells.length === 6);
    assert.ok(table, `${requirement.id} has a requirement row`);
    assert.equal(table[1], requirement.description);
    // The GCP column of the cross-reference matrix names the requirement's own topics.
    const matrix = ursRows.find(cells => cells[0] === requirement.id && cells.length === 5);
    assert.ok(matrix, `${requirement.id} has a cross-reference row`);
    assert.equal(matrix[4], requirement.e6r3.map(key => e6r3(key)).join('; '));
    assert.ok(urs.includes(`**${requirement.id}: ${requirement.title}**`), `${requirement.id} has a detailed description`);
    // Each cited case is printed with what it actually checks.
    for (const id of ta3RequirementCases(requirement)) assert.ok(urs.includes(runnerCaseCheck(id).check), `${requirement.id}: ${id}`);
  }
  assert.ok(urs.includes('Every retained document reads back with its hash after a redeployment: Gap'), 'URS-099 is an open gap');

  assert.ok(frs.includes('## TA3 Platform Operations (FRS-087 to FRS-107)'));
  assert.ok(frs.includes('- [TA3 Platform Operations (FRS-087 to FRS-107)]'), 'the table of contents lists the TA3 section');
  assert.match(frs, /\*\*Total Functional Requirements:\*\* 107/);
  const ursIds = new Set(ursRows.filter(cells => cells.length === 6).map(cells => cells[0]));
  const frsRows = rows(frs, 'FRS-');
  // Every FRS, old or new, cites an existing URS, and every TA3 URS has its FRS.
  for (const [frsId, ursRef] of frsRows) assert.ok(ursIds.has(ursRef), `${frsId} cites ${ursRef}`);
  for (const requirement of TA3_REQUIREMENTS) {
    const row = frsRows.find(cells => cells[0] === requirement.frs.id);
    assert.ok(row, requirement.frs.id);
    assert.deepEqual(row.slice(1, 4), [requirement.id, requirement.frs.requirement, requirement.frs.implementation]);
    const cases = ta3RequirementCases(requirement);
    assert.equal(row[4], cases.length ? cases.join(', ') : `No runner case; see the planned verification of ${requirement.id}`);
  }

  const applicability = generated(directory, '01-applicability-assessment.md');
  for (const record of REGULATORY_SCOPE.regulatedRecords.slice(15)) assert.ok(applicability.includes(`| ${record.id} | ${record.name} |`), record.id);
  assert.match(applicability, /All 28 record types are regulated electronic records/);
});
