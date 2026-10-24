import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SYSTEM_INFO } from '../config/system-info';
import { generate as generateOqProtocol } from '../generators/08-oq-protocol';
import { generate as generatePqProtocol } from '../generators/09-pq-protocol';
import { executionPeriod, generate as generateExecutionRecords } from '../generators/20-test-execution-records';
import { generate as generateIqProtocol, iqProtocolCases } from '../generators/07-iq-protocol';
import { IQ_APPENDIX_ROWS } from '../generators/18-regulatory-requirements-map';
import { APPROVAL_STATEMENT, approvalBlock, e6r3StatusRow, masterEvidenceIndexHeader } from '../generators/helpers/markdown-writer';
import { recordedTargetUrl, systemVersionText } from '../generators/helpers/version-stamper';
import { E6_R3_SECTION_STATUS, ICH_E6_R3 } from '../config/regulatory-scope';
import { releaseIdentityFromInputs, setReleaseIdentity } from '../runners/release-identity';
import { generateAllDocuments, temporaryDirectory } from './generated-documents';

const root = path.resolve(__dirname, '..');
/** A blank line for a name, signature or date. */
const SIGNATURE_LINE = /_{3,}/;

/** The retired single-host deployment and the Python pipeline the framework once described. */
const RETIRED_DESCRIPTION = /Lightsail|PostgreSQL 15|15\+ \(Relational|LangGraph|FastAPI|Python 3\.11|one Python pipeline/;

test('the system description names the ECS Fargate and RDS PostgreSQL 14 deployment and the Intelligence Layer as a separate system', t => {
  assert.equal(SYSTEM_INFO.architecture.database.version, '14');
  assert.equal(SYSTEM_INFO.environments.production.databaseHost, 'AWS RDS PostgreSQL 14 (accuratrials-hipaa-db)');
  assert.equal(SYSTEM_INFO.environments.staging.databaseHost, 'not documented');
  assert.equal(SYSTEM_INFO.infrastructure.hosting,
    'AWS ECS Fargate in us-east-2 (API, core and training services); frontend on Vercel per EDCProjectCompliant/vercel.json');
  assert.equal(SYSTEM_INFO.infrastructure.containerization, 'Docker images on ECS');
  assert.equal(SYSTEM_INFO.architecture.aiPipeline.name, 'Intelligence Layer (separate system; see the platform inventory)');
  assert.match(SYSTEM_INFO.intendedUse, /TA3 platform trial uses/);
  const documents = generateAllDocuments(temporaryDirectory(t, 'accura-description-'));
  for (const [name, content] of documents) assert.doesNotMatch(content, RETIRED_DESCRIPTION, name);
  assert.match(documents.get('01-applicability-assessment.md')!, /\| Production \| https:\/\/api\.accuratrials\.com \| https:\/\/app\.accuratrials\.com \| AWS RDS PostgreSQL 14 \(accuratrials-hipaa-db\) \|/);
  assert.match(documents.get('07-iq-protocol.md')!, /### IQ-009: PostgreSQL version is 14\n/);
  assert.match(documents.get('21-design-specification.md')!, /\| Database \| AWS RDS PostgreSQL 14 \| Instance accuratrials-hipaa-db \|/);
});

test('the OQ and PQ protocols and the execution records name the recorded target, never the production environment', t => {
  const production = SYSTEM_INFO.environments.production;
  const productionFacts = [production.apiUrl, production.frontendUrl, production.databaseHost, SYSTEM_INFO.infrastructure.hosting];
  const environmentDocuments = (directory: string) => {
    generateOqProtocol(directory, directory);
    generatePqProtocol(directory, directory);
    generateExecutionRecords(directory, directory);
    return ['08-oq-protocol.md', '09-pq-protocol.md', '20-test-execution-records.md']
      .map((name): [string, string] => [name, fs.readFileSync(path.join(directory, name), 'utf8')]);
  };

  setReleaseIdentity(undefined);
  t.after(() => setReleaseIdentity(undefined));
  for (const [name, content] of environmentDocuments(temporaryDirectory(t, 'accura-environment-'))) {
    for (const fact of productionFacts) assert.equal(content.includes(fact), false, `${name} names ${fact}`);
    assert.match(content, name.startsWith('20-') ? /- \*\*API Endpoint:\*\* Recorded at execution\n/ : /\| API URL \| Recorded at execution \|/, name);
  }

  const identity = releaseIdentityFromInputs({ api: 'a'.repeat(40), ui: 'b'.repeat(40), core: `sha256:${'c'.repeat(64)}` });
  setReleaseIdentity({ ...identity, target: { url: 'http://localhost:3000/health', observedAt: '2026-10-24T00:00:00.000Z', status: 200, version: '1.0.0' } });
  const observed = 'http://localhost:3000 (target in the release identity, observed 2026-10-24T00:00:00.000Z)';
  for (const [name, content] of environmentDocuments(temporaryDirectory(t, 'accura-environment-'))) {
    for (const fact of productionFacts) assert.equal(content.includes(fact), false, `${name} names ${fact}`);
    assert.ok(content.includes(observed), `${name} names the observed target`);
  }
});

test('every approval block states that approval is recorded in the eTMF and carries no signature line', t => {
  const block = approvalBlock(['QA Lead', 'Validation Lead']);
  assert.ok(block.startsWith(`## Approval Signatures\n\n${APPROVAL_STATEMENT}\n`), block);
  assert.match(block, /\| QA Lead \| To approve \|\n\| Validation Lead \| To approve \|/);
  assert.doesNotMatch(block, SIGNATURE_LINE);

  const documents = generateAllDocuments(temporaryDirectory(t, 'accura-approval-'));
  let blocks = 0;
  for (const [name, content] of documents) {
    const start = content.indexOf('\n## Approval Signatures\n');
    if (start < 0) continue;
    blocks++;
    const end = content.indexOf('\n---', start);
    const approval = content.slice(start, end < 0 ? undefined : end);
    assert.ok(approval.includes(APPROVAL_STATEMENT), `${name} states where approval is recorded`);
    assert.doesNotMatch(approval, SIGNATURE_LINE, name);
    assert.doesNotMatch(approval, /\| Signature \|/, name);
  }
  assert.ok(blocks >= 20, `${blocks} documents carry an approval block`);
  assert.doesNotMatch(documents.get('19-csa-feature-assurance.md')!, SIGNATURE_LINE, 'CSA records carry no blank approval line');

  // The master evidence index and the editable templates render approval the same way.
  const masterIndex = fs.readFileSync(path.join(root, 'generate.ts'), 'utf8');
  assert.match(masterIndex, /lines\.push\(approvalBlock\(\['QA Lead', 'Validation Lead'\]\)\);/);
  for (const file of ['generate.ts', 'templates/approval-signatures.md', 'templates/cover-page.md']) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(content, SIGNATURE_LINE, file);
    if (file.startsWith('templates/')) assert.ok(content.replace(/\r?\n/g, ' ').includes(APPROVAL_STATEMENT), file);
  }
});

test('a failed version endpoint is stated as such, never as an observed target (RF-012)', t => {
  t.after(() => setReleaseIdentity(undefined));
  const identity = releaseIdentityFromInputs({ api: 'a'.repeat(40), ui: 'b'.repeat(40), core: `sha256:${'c'.repeat(64)}` });
  const target = (extra: Record<string, unknown>) => recordedTargetUrl({
    ...identity, target: { url: 'http://127.0.0.1:3109/health', observedAt: '2026-10-24T00:00:00.000Z', status: 0, ...extra },
  });
  assert.equal(target({ error: 'fetch failed | ECONNREFUSED\n127.0.0.1:3109' }),
    'http://127.0.0.1:3109 (target named in the release identity; its version endpoint failed at 2026-10-24T00:00:00.000Z: fetch failed ECONNREFUSED 127.0.0.1:3109)');
  assert.equal(target({ status: 503 }),
    'http://127.0.0.1:3109 (target named in the release identity; its version endpoint failed at 2026-10-24T00:00:00.000Z: HTTP 503)');
  assert.equal(target({ status: 200 }), 'http://127.0.0.1:3109 (target in the release identity, observed 2026-10-24T00:00:00.000Z)');
  setReleaseIdentity({ ...identity, target: { url: 'http://127.0.0.1:3109/health', observedAt: '2026-10-24T00:00:00.000Z', status: 0, error: 'fetch failed' } });
  const directory = temporaryDirectory(t, 'accura-failed-target-');
  generateOqProtocol(directory, directory);
  const protocol = fs.readFileSync(path.join(directory, '08-oq-protocol.md'), 'utf8');
  assert.ok(protocol.includes('its version endpoint failed at 2026-10-24T00:00:00.000Z: fetch failed'), 'the OQ protocol states the failure');
  assert.doesNotMatch(protocol, /target in the release identity, observed/);
});

test('the master evidence index opens with the ICH E6(R3) status row every document carries (RF-010)', () => {
  const header = masterEvidenceIndexHeader('2026-10-24T00:00:00.000Z');
  assert.ok(header.includes(e6r3StatusRow()), header.join('\n'));
  assert.equal(e6r3StatusRow(), `| ${ICH_E6_R3.citation} Section References | ${E6_R3_SECTION_STATUS} |`);
  assert.deepEqual(header.slice(0, 5),
    ['# Master Test Execution Evidence Index', '', '| Field | Value |', '|-------|-------|', '| Generated | 2026-10-24T00:00:00.000Z |']);
  // generate.ts builds the index from this header, so the row cannot be dropped there.
  assert.match(fs.readFileSync(path.join(root, 'generate.ts'), 'utf8'), /\.\.\.masterEvidenceIndexHeader\(new Date\(\)\.toISOString\(\)\),/);
});

test('the validation plan has QA approve in the eTMF; the records state the version label, the record dates and the framework that ran (RF-011, IR-041)', t => {
  setReleaseIdentity(undefined);
  t.after(() => setReleaseIdentity(undefined));
  const documents = generateAllDocuments(temporaryDirectory(t, 'accura-docfix-'));
  const plan = documents.get('02-validation-plan.md')!;
  assert.doesNotMatch(plan, /signs final validation summary report/);
  assert.match(plan, /approves the final validation summary report in the eTMF, as a governance decision on the filing of its package \(TMF-FILING\.md\)/);
  // The version label the EDC API reports at /health (test:cross-repo compares it with the EDC), never the retired 1.0.0.
  assert.equal(SYSTEM_INFO.version, '0.1.0');
  const records = documents.get('20-test-execution-records.md')!;
  assert.match(records, /- \*\*System Version:\*\* 0\.1\.0 \(version label\); release under test not recorded: no release identity was supplied\n/);
  assert.match(records, /- \*\*Test Execution Date:\*\* Not executed: no evidence record in this package\n/);
  assert.doesNotMatch(records, /tests-live/);
  assert.match(records, /executed by the runner of this validation framework that its category names/);
  assert.equal(executionPeriod([]), 'Not executed: no evidence record in this package');
  const at = (timestamp: string) => ({ timestamp } as Parameters<typeof executionPeriod>[0][number]);
  assert.equal(executionPeriod([at('2026-10-24T03:00:00.000Z'), at('2026-10-23T22:15:00Z'), at('not a time')]),
    '2026-10-23T22:15:00.000Z to 2026-10-24T03:00:00.000Z (UTC, from the record timestamps); 1 record(s) carry no valid timestamp');
  const identity = releaseIdentityFromInputs({ api: 'a'.repeat(40), ui: 'none', core: 'none', training: 'none' });
  assert.equal(systemVersionText(identity), `0.1.0 (version label); release under test ${identity.identityHash}`);
  // The summary's IQ scope names no Python environment.
  assert.doesNotMatch(documents.get('12-validation-summary.md')!, /Python/);
});

test('the regulatory map names the ALB, not Nginx, and its IQ appendix rows are the cases that cite each section', t => {
  const map = generateAllDocuments(temporaryDirectory(t, 'accura-map-')).get('18-regulatory-requirements-map.md')!;
  assert.doesNotMatch(map, /Nginx/);
  assert.match(map, /Infrastructure \(AWS ALB accuratrials-alb for the API; Vercel for the frontend\)/);
  // The sections a protocol entry cites, from its cfr text ("§11.10(c) — Protection of records; HIPAA §164.312(e)(1)").
  const sectionsOf = (cfr: string) => cfr.split(';').map(part => part.replace(/ — .*$/, '').replace(/ Validation$/, '').trim());
  const cited = (section: string) => iqProtocolCases().filter(entry => sectionsOf(entry.cfr).includes(section)).map(entry => entry.id);
  for (const [ids, section] of IQ_APPENDIX_ROWS) {
    assert.deepEqual(ids.split(', '), cited(section), `${section}: the row lists exactly the cases whose protocol entry cites it`);
    assert.ok(map.includes(`| ${ids} | ${section} |`), ids);
  }
  assert.doesNotMatch(map, /IQ-005, IQ-006 \| §11\.10\(d\)/);
});

test('the IQ protocol names the target under test and the declaration for IQ-019, 020, 022, 023 and 029, never production', t => {
  setReleaseIdentity(undefined);
  t.after(() => setReleaseIdentity(undefined));
  const directory = temporaryDirectory(t, 'accura-iq-protocol-');
  generateIqProtocol(directory, directory);
  const protocol = fs.readFileSync(path.join(directory, '07-iq-protocol.md'), 'utf8');
  const caseText = (id: string) => {
    const start = protocol.indexOf(`### ${id}:`);
    return protocol.slice(start, protocol.indexOf('### ', start + 4));
  };
  const production = SYSTEM_INFO.environments.production;
  for (const id of ['IQ-019', 'IQ-020', 'IQ-022', 'IQ-023', 'IQ-029']) {
    const text = caseText(id);
    assert.ok(text.length > 20, id);
    for (const url of [production.apiUrl, production.frontendUrl, production.apiUrl.replace('https', 'http')]) {
      assert.equal(text.includes(url), false, `${id} names ${url}`);
    }
    assert.match(text, /target under test|--target-config/, id);
    assert.doesNotMatch(text, /NODE_ENV is set to "production"|on the production server|points to the production database/, id);
  }
  assert.match(caseText('IQ-029'), /NO_TARGET_CONFIGURATION/);
  assert.doesNotMatch(caseText('IQ-029'), /docker-compose\.test-env/);
});
