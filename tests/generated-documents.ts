import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** A temporary directory that is removed after the test. */
export function temporaryDirectory(t: { after(callback: () => void): void }, prefix: string): string {
  const base = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(base, prefix));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), base);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

/** A documents-only run of every numbered generator, keyed by file name. The
 * output directory is also the workspace root, so no sibling checkout is read. */
export function generateAllDocuments(directory: string): Map<string, string> {
  const generators = path.resolve(__dirname, '..', 'generators');
  for (const file of fs.readdirSync(generators).filter(name => /^\d{2}-.+\.ts$/.test(name)).sort()) {
    const generator = require(path.join(generators, file)) as { generate(outputDir: string, workspaceRoot: string): void };
    generator.generate(directory, directory);
  }
  return new Map(fs.readdirSync(directory).filter(name => name.endsWith('.md')).sort()
    .map((name): [string, string] => [name, fs.readFileSync(path.join(directory, name), 'utf8')]));
}
