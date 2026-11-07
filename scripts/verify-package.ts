import * as path from 'node:path';
import { verifyCitedRunFiles, verifyPackage, PUBLIC_DATA_BASIS_FILE } from '../runners/evidence-package';

// npm run verify:package -- <package directory> [--run-dir <run directory>]
// Exits 0 only when every file package-manifest.json lists is present with its
// byte count and SHA-256, no unlisted file exists and the package hash
// recomputes; it then prints the SHA-256 of package-manifest.json, the
// contentHash the eTMF must show for the filed manifest (TMF-FILING.md). A
// package whose framework checkout was dirty or changed during the run verifies
// too, and the output says it is not a run of record. With --run-dir it also
// rechecks what the package's benchmark rows recorded about that run directory,
// because a package keeps hashes and never the cited files: the run summary, the
// metrics and every file a row verified are re-hashed, and a file a row refused
// (missing, mismatched or outside the run) must still show what was recorded, so the
// directory of a failed run verifies too. Exit 1 when anything differs.

const [directory, ...rest] = process.argv.slice(2);
const runDirectory = rest[0] === '--run-dir' && rest.length === 2 ? rest[1] : undefined;
if (!directory || directory.startsWith('--') || (rest.length && !runDirectory)) {
  console.error('Usage: npm run verify:package -- <package directory> [--run-dir <run directory>]');
  process.exitCode = 2;
} else {
  // npm runs the script from the package root; a relative path means the caller's directory.
  const base = process.env.npm_lifecycle_event === 'verify:package' && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();
  const result = verifyPackage(path.resolve(base, directory));
  if (result.ok && result.manifest && result.manifestSha256) {
    const { manifest } = result;
    console.log(`Package verified: ${result.dir}`);
    if (result.restricted) console.log(`  ${result.restricted}`);
    if (result.restrictedNoticeMissing) {
      console.log(`  TMF-FILING.md does not open with the RESTRICTED notice: follow the line above, not the filing, and upload only package-manifest.json and the validation summaries.`);
    }
    if (result.notRunOfRecord) console.log(`  ${result.notRunOfRecord}`);
    console.log(`  Package ID:   ${manifest.packageId} (${manifest.version})`);
    console.log(`  Synthetic:    ${manifest.synthetic ? `yes (${manifest.syntheticBasis.join(', ')})` : 'no'}`);
    // The package recorded no classification beyond this: an imported run that is not synthetic was admitted (D-LE-14).
    const basisCopy = manifest.files.find(file => file.path === PUBLIC_DATA_BASIS_FILE);
    if (basisCopy) console.log(`  Declared public data: yes, under the filed basis ${basisCopy.path}, SHA-256 ${basisCopy.sha256}`);
    console.log(`  Executed:     ${manifest.executed ? 'yes' : 'no, documents only'}`);
    console.log(`  Files:        ${manifest.files.length}, every byte count and SHA-256 matches`);
    console.log(`  Package hash: ${manifest.packageHash}`);
    console.log(`package-manifest.json SHA-256: ${result.manifestSha256}`);
    if (runDirectory) {
      const cited = verifyCitedRunFiles(result.dir, path.resolve(base, runDirectory));
      if (cited.problems.length) {
        console.error(`Run directory NOT verified against the package: ${path.resolve(base, runDirectory)}`);
        for (const problem of cited.problems) console.error(`  [FAIL] ${problem}`);
        process.exitCode = 1;
      } else {
        console.log(`Run directory verified: ${cited.checked} files the package cites rechecked; ${cited.rehashed} re-hashed to the SHA-256 recorded, `
          + `${cited.checked - cited.rehashed} refused by the import still missing or outside the run, as recorded`);
      }
    }
  } else {
    console.error(`Package NOT verified: ${result.dir}`);
    for (const problem of result.problems) console.error(`  [FAIL] ${problem}`);
    console.error('Do not file this package.');
    process.exitCode = 1;
  }
}
