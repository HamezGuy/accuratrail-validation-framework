// Exercise the real CommandCenter scorer and reconstructor with its own scorer
// fixture. This never calls a product and is not product performance evidence.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, dir] = process.argv.slice(2);
const load = relative => import(pathToFileURL(path.join(root, relative)).href);
const fx = await load('synthetic-trial/evaluate/scorer-fixture/fixture.mjs');
const { evaluatorIdentity, scoreRun, serializeOutputs } = await load('synthetic-trial/evaluate/score.mjs');
const evaluator = await evaluatorIdentity();
const cases = fx.baseCases();
const bytes = fx.buildBytes({ evaluator, cases, observations: cases.map(c => fx.answer(c)) });
const sources = {};
fs.mkdirSync(dir, { recursive: true });
for (const [name, content] of Object.entries(bytes)) {
  if (!content) continue;
  const file = path.join(dir, `input-${name}.json`);
  fs.writeFileSync(file, content);
  sources[name] = file;
}
const scored = scoreRun({ bytes, evaluator, sources });
for (const [name, content] of Object.entries(serializeOutputs(scored).files)) {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}
