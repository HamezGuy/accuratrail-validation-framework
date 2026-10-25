import * as path from 'node:path';
import { verifyPackage } from '../runners/evidence-package';

// npm run verify:package -- <package directory>
// Exits 0 only when every file package-manifest.json lists is present with its
// byte count and SHA-256, no unlisted file exists and the package hash
// recomputes; it then prints the SHA-256 of package-manifest.json, the
// contentHash the eTMF must show for the filed manifest (TMF-FILING.md). A
// package whose framework checkout was dirty or changed during the run verifies
// too, and the output says it is not a run of record.

const [directory, ...rest] = process.argv.slice(2);
if (!directory || rest.length) {
  console.error('Usage: npm run verify:package -- <package directory>');
  process.exitCode = 2;
} else {
  // npm runs the script from the package root; a relative path means the caller's directory.
  const base = process.env.npm_lifecycle_event === 'verify:package' && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();
  const result = verifyPackage(path.resolve(base, directory));
  if (result.ok && result.manifest && result.manifestSha256) {
    const { manifest } = result;
    console.log(`Package verified: ${result.dir}`);
    if (result.restricted) console.log(`  ${result.restricted}`);
    if (result.notRunOfRecord) console.log(`  ${result.notRunOfRecord}`);
    console.log(`  Package ID:   ${manifest.packageId} (${manifest.version})`);
    console.log(`  Synthetic:    ${manifest.synthetic ? `yes (${manifest.syntheticBasis.join(', ')})` : 'no'}`);
    console.log(`  Executed:     ${manifest.executed ? 'yes' : 'no, documents only'}`);
    console.log(`  Files:        ${manifest.files.length}, every byte count and SHA-256 matches`);
    console.log(`  Package hash: ${manifest.packageHash}`);
    console.log(`package-manifest.json SHA-256: ${result.manifestSha256}`);
  } else {
    console.error(`Package NOT verified: ${result.dir}`);
    for (const problem of result.problems) console.error(`  [FAIL] ${problem}`);
    console.error('Do not file this package.');
    process.exitCode = 1;
  }
}
