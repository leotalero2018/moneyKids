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
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXPECTED_CALLABLES as expected } from './deploy-contract.mjs';

// Stand in for what GCF injects, so the predeploy hook and CI run this in an
// identical environment: firebase-tools injects GCLOUD_PROJECT into predeploy
// hooks but not FIREBASE_CONFIG.
//
// Assigned unconditionally, never defaulted. On a production deploy
// firebase-tools puts the LIVE project in GCLOUD_PROJECT, and this imports the
// bundle — running module-scope initializeApp() — moments before deploying it.
// Module scope should only be initializing, but nothing enforces that, and
// this is the one file where "money mutations happen only inside callables"
// has to hold.
//
// What this actually guarantees: a dummy project id, and Firestore, Auth and
// Storage pointed at a dead port. What it does NOT guarantee is the absence of
// credentials — application default credentials live in a file that
// google-auth-library finds with no environment variable at all, so clearing
// the env vars is not enough. CLOUDSDK_CONFIG moves that lookup to a scratch
// path, but an arbitrary GCP client or a raw REST call at module scope could
// still authenticate some other way. Treat this as defence in depth, not a
// sandbox.
process.env.GCLOUD_PROJECT = 'money-kids-smoke';
process.env.GOOGLE_CLOUD_PROJECT = 'money-kids-smoke';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'money-kids-smoke' });
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:1';
process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:1';
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.GOOGLE_CREDENTIALS;
// Point the gcloud config — where `gcloud auth application-default login`
// writes its credentials file — at a directory that holds none.
process.env.CLOUDSDK_CONFIG = resolve(tmpdir(), 'money-kids-smoke-gcloud');

const dir = resolve(process.argv[2] ?? 'deploy');
// --strict is for CI, which installs the pinned tree first and runs on the
// runtime's Node major. The predeploy hook cannot use it: it has just rebuilt
// the staged directory, so no node_modules exists there yet, and a developer's
// machine is not required to be on Node 20.
const strict = process.argv.includes('--strict');
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

// Which tree did the bundle's own imports actually resolve against?
//
// Installing the staged manifest proves it resolves; it never evaluates a
// require. The jose/node-fetch class of break — a CommonJS package requiring
// an ESM-only dependency — lives precisely in that gap, and only shows up when
// something imports the bundle on the runtime's Node version. So say out loud
// which tree was exercised rather than leaving it to be inferred from CI step
// ordering.
const pinned = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8')).dependencies;
const installed = existsSync(resolve(dir, 'node_modules'));
if (installed) {
  const requireFromBundle = createRequire(resolve(dir, 'index.js'));
  // Resolve the package's main entry and walk up to its manifest: packages
  // with an exports map (firebase-admin among them) do not expose
  // ./package.json, so it cannot be required directly.
  const manifestFor = async (dep) => {
    let at = dirname(requireFromBundle.resolve(dep));
    for (;;) {
      const candidate = resolve(at, 'package.json');
      if (existsSync(candidate)) {
        const pkg = JSON.parse(await readFile(candidate, 'utf8'));
        if (pkg.name === dep) return pkg;
      }
      const up = dirname(at);
      if (up === at) throw new Error(`cannot locate the manifest for ${dep} from the bundle`);
      at = up;
    }
  };
  const drifted = [];
  for (const dep of Object.keys(pinned)) {
    const { version } = await manifestFor(dep);
    if (version !== pinned[dep]) drifted.push(`${dep}: pinned ${pinned[dep]}, loaded ${version}`);
  }
  if (drifted.length > 0) {
    throw new Error(`the bundle loaded a different tree than the manifest pins:\n  ${drifted.join('\n  ')}`);
  }
  console.log(`  resolved against the pinned deploy tree on node ${process.version}`);
} else if (strict) {
  throw new Error(
    `--strict requires the pinned tree: run \`npm ci --omit=dev --workspaces=false\` in ${dir} first, ` +
      'otherwise this exercises the workspace hoisting rather than what production installs',
  );
} else {
  console.log(
    `  resolved against the workspace tree on node ${process.version} — run npm ci in ${dir} ` +
      'to exercise what production installs',
  );
}

// The runtime the deployed functions actually run on. Checked only under
// --strict, since a developer deploying from a newer Node is fine — but CI
// asserting on the wrong major would make every ESM finding here meaningless,
// which is how the jose break reached a green local run in the first place.
if (strict) {
  const engines = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8')).engines?.node;
  const want = String(engines ?? '').match(/\d+/)?.[0];
  const have = process.version.match(/\d+/)?.[0];
  if (!want) throw new Error('the staged manifest declares no engines.node to check against');
  if (want !== have) {
    throw new Error(
      `this must run on the deployed runtime: engines.node is ${engines}, this is ${process.version}`,
    );
  }
  console.log(`  node major matches the deployed runtime (${engines})`);
}

console.log(`bundle loaded; ${expected.length} callables match the contract`);
