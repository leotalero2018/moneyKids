// Verifies the staged bundle actually loads and exposes the deploy contract.
// Neither the metafile nor the build-time import guards see a dynamic require
// from inlined code, and the banner injects createRequire, so importing the
// bundle is what catches a cold-start crash.
//
// Takes the staged directory as an argument so this file stays in scripts/
// and is never uploaded with the function.
//
//   node scripts/smoke.mjs deploy
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXPECTED_CALLABLES as expected } from './deploy-contract.mjs';

const dir = resolve(process.argv[2] ?? 'deploy');
const mod = await import(pathToFileURL(resolve(dir, 'index.js')).href);
const actual = Object.keys(mod);

const missing = expected.filter((n) => !actual.includes(n));
const extra = actual.filter((n) => !expected.includes(n));
if (missing.length || extra.length) {
  throw new Error(
    'bundle exports do not match the deploy contract' +
      `${missing.length ? `\n  missing: ${missing.join(', ')}` : ''}` +
      `${extra.length ? `\n  unexpected: ${extra.join(', ')}` : ''}`,
  );
}

// A name is not enough: `export const approveInvoice = 5` would satisfy the
// build-time export check. firebase-functions marks a real callable with
// __endpoint, which is what the deploy tooling reads.
const notCallable = expected.filter((n) => typeof mod[n] !== 'function' || !mod[n].__endpoint);
if (notCallable.length) {
  throw new Error(`exported but not a deployable callable: ${notCallable.join(', ')}`);
}

console.log(`bundle loaded; ${expected.length} callables match the contract`);
