// Verifies the staged bundle actually loads and exposes the deploy contract.
// Neither the metafile nor the build-time import guards see a dynamic require
// from inlined code, and the banner injects createRequire, so importing the
// bundle is what catches a cold-start crash.
//
// It only exercises module scope. A dynamic require inside a callable body is
// invisible to the metafile, to guards 1-2, and to this check, and would still
// crash at invocation in production.
//
// Takes the staged directory as an argument so this file stays in scripts/
// and is never uploaded with the function.
//
//   node scripts/smoke.mjs deploy
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXPECTED_CALLABLES as expected } from './deploy-contract.mjs';

// Stand in for what GCF injects, so the predeploy hook and CI run this in an
// identical environment: firebase-tools injects GCLOUD_PROJECT into predeploy
// hooks but not FIREBASE_CONFIG.
//
// Assigned unconditionally, never defaulted. On a production deploy
// firebase-tools puts the LIVE project in GCLOUD_PROJECT, and this imports the
// bundle — running module-scope initializeApp() — moments before deploying it,
// with application default credentials available. Module scope should only be
// initializing, but nothing enforces that, and this is the one file where
// "money mutations happen only inside callables" has to hold. So: a dummy
// project, emulator hosts on a dead port, and no credentials. Fail closed.
process.env.GCLOUD_PROJECT = 'money-kids-smoke';
process.env.GOOGLE_CLOUD_PROJECT = 'money-kids-smoke';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'money-kids-smoke' });
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:1';
process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:1';
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.GOOGLE_CREDENTIALS;

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
