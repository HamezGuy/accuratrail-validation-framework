import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SYSTEM_INFO } from '../config/system-info';
import { generate as generateOqProtocol } from '../generators/08-oq-protocol';
import { generate as generatePqProtocol } from '../generators/09-pq-protocol';
import { generate as generateExecutionRecords } from '../generators/20-test-execution-records';
import { APPROVAL_STATEMENT, approvalBlock } from '../generators/helpers/markdown-writer';
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
