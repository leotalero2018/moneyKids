// Builds the artifact that Cloud Build actually installs.
//
// Cloud Build runs `npm install` inside `functions.source` in isolation from
// the npm workspace, so it cannot resolve `@money-kids/shared` — that package
// is local and unpublished. esbuild already inlines it, so it is a build-time
// dependency only. Rather than delete it from functions/package.json (which
// would leave src/ importing a package no manifest declares, and make the
// money helpers resolve through an unpinned symlink), we emit a staging
// directory whose generated manifest lists only the published runtime
// externals. functions/package.json stays honest for local dev, typecheck and
// vitest; Cloud Build never sees the workspace package.
//
// This script runs on every `npm run build -w @money-kids/functions`, which
// the emulator and e2e scripts depend on, so it must not touch the network.
// The staged lockfile is therefore committed (deploy.lock.json) rather than
// resolved at build time; refresh it deliberately with:
//
//   npm run stage:lock -w @money-kids/functions
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '..');
const outDir = resolve(root, 'deploy');
const lockSrc = resolve(root, 'deploy.lock.json');
const refreshLock = process.argv.includes('--refresh-lock');

// Anything NOT listed here must be inlined into the bundle. Adding an entry
// means Cloud Build has to install it, so it must be published on npm.
const EXTERNALS = ['firebase-admin', 'firebase-functions'];

// Only these trees may contribute code to the bundle. Listed package by
// package so that adding a workspace package does not silently make it
// shippable into the functions runtime.
const FIRST_PARTY = [resolve(root, 'src'), resolve(repoRoot, 'packages/shared')];

// The bundle must carry the shared money code, not just resolve the import.
const REQUIRED_INPUT = resolve(repoRoot, 'packages/shared');

const fail = (msg) => {
  throw new Error(msg);
};

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

// True when `abs` is inside `dir`. Uses relative() rather than a '/' prefix
// so this holds on Windows, where resolve() yields backslashes.
const isInside = (dir, abs) => {
  const rel = relative(dir, abs);
  return rel !== '' && !rel.startsWith('..') && !resolve(dir, rel).startsWith('..') && !rel.startsWith(sep) && rel !== '..';
};

// Reads the installed manifest off disk rather than require()-ing it: packages
// with an `exports` map (firebase-admin among them) do not expose
// ./package.json. npm hoists workspace deps to the repo root, but check the
// package-local tree first in case a version conflict forced a nested copy.
// NOTE: this pins to whatever is in the *builder's* node_modules, which the
// root lockfile governs only if the builder ran `npm ci`.
async function installedVersion(dep) {
  for (const base of [resolve(root, 'node_modules'), resolve(repoRoot, 'node_modules')]) {
    try {
      const { version } = JSON.parse(await readFile(resolve(base, dep, 'package.json'), 'utf8'));
      if (version) return version;
    } catch {
      // not installed in this tree; try the next one
    }
  }
  return fail(`cannot resolve an installed version for ${dep} — run npm install`);
}

// Stale files in an existing deploy/ would be uploaded alongside the fresh
// ones, so never build on top of a previous run.
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  absWorkingDir: root, // makes metafile paths deterministic regardless of cwd
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: resolve(outDir, 'index.js'),
  external: EXTERNALS,
  sourcemap: true,
  metafile: true,
  banner: {
    // The Node 20 GCF runtime does not enable source maps by default, so the
    // emitted .map would be dead weight without this — a stack trace from a
    // money callable would point at generated code.
    js:
      "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" +
      '\nprocess.setSourceMapsEnabled(true);',
  },
});

const inputs = Object.keys(result.metafile.inputs).map((f) => resolve(root, f));

// 1. Every bundled input must come from first-party source. `shared` carries
// the minor-unit money helpers and resolves through the workspace symlink in
// the ROOT node_modules — nothing in functions/ pins that resolution. If a
// same-named package from a registry ever won, the bundle would still be
// self-contained and the build would stay green while inlining the wrong
// money code. Rejecting node_modules explicitly first: the positive check
// alone would accept packages/shared/node_modules/**, which is a nested
// dependency, not first-party source. Under --preserve-symlinks the shared
// inputs resolve inside node_modules and this fails the build — noisy, but it
// fails closed.
const nested = inputs.filter((abs) => abs.split(sep).includes('node_modules'));
const outside = inputs.filter((abs) => !FIRST_PARTY.some((dir) => isInside(dir, abs)));
const foreign = [...new Set([...nested, ...outside])];
if (foreign.length > 0) {
  const allowed = FIRST_PARTY.map((d) => relative(repoRoot, d)).join(' or ');
  fail(
    `bundle inlines code from outside first-party source: ${foreign.slice(0, 5).join(', ')}` +
      `${foreign.length > 5 ? ` (+${foreign.length - 5} more)` : ''}\n` +
      `Every bundled input must live in ${allowed}, and never under node_modules. ` +
      'Check that @money-kids/shared still resolves to the local workspace package.',
  );
}

// 2. Nothing may escape the bundle except a declared external or a node
// builtin — anything else is a module Cloud Build cannot install, which would
// surface as a cold-start crash instead of a build failure.
const allowedSpecifiers = new Set([...EXTERNALS, ...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
// `firebase-admin/firestore` belongs to `firebase-admin`, so compare the
// package name (scoped names keep two segments: `@scope/name`).
const packageOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
const escaped = Object.entries(result.metafile.outputs)
  // only the JS output can carry imports; whether the .map entry even has an
  // `imports` key varies by esbuild version, and this is the guard that must
  // not crash on itself
  .filter(([file]) => file.endsWith('.js'))
  .flatMap(([, o]) => (o.imports ?? []).map((i) => i.path))
  .filter((p) => !p.startsWith('./') && !p.startsWith('../') && !allowedSpecifiers.has(packageOf(p)));
if (escaped.length > 0) {
  fail(
    `bundle is not self-contained: ${[...new Set(escaped)].join(', ')}\n` +
      'Either inline it (remove from EXTERNALS) or, if it is published on npm, ' +
      'add it to EXTERNALS and to functions/package.json dependencies.',
  );
}

// 3. The shared money code must actually be in the bundle, asserted from the
// metafile rather than by grepping for an identifier: a rename in shared would
// otherwise fail the build with a misleading "resolved to a stub".
if (!inputs.some((abs) => isInside(REQUIRED_INPUT, abs))) {
  fail('bundle contains no code from packages/shared — @money-kids/shared resolved to a stub or empty module');
}

// 4. Every callable declared in src/index.ts must survive into the bundle's
// export surface. A callable that silently stops being exported deploys as a
// deleted function, which is the failure mode that actually reaches families.
const declared = [...(await readFile(resolve(root, 'src/index.ts'), 'utf8')).matchAll(/^export const (\w+)/gm)].map(
  (m) => m[1],
);
const exported = new Set(
  Object.entries(result.metafile.outputs)
    .filter(([file]) => file.endsWith('.js'))
    .flatMap(([, o]) => o.exports ?? []),
);
const missing = declared.filter((name) => !exported.has(name));
if (declared.length === 0) fail('found no `export const` callables in src/index.ts — the export scan is broken');
if (missing.length > 0) fail(`callables declared in src/index.ts but missing from the bundle: ${missing.join(', ')}`);

// 5. Every external must be declared, so the generated manifest carries a real
// version. The reverse is only a warning: a dependency that is not an external
// gets inlined, which is usually what we want but breaks for native modules
// and dynamic requires.
for (const dep of EXTERNALS) {
  if (!pkg.dependencies?.[dep]) fail(`external missing from functions/package.json dependencies: ${dep}`);
}
const inlined = Object.keys(pkg.dependencies ?? {}).filter(
  (dep) => !EXTERNALS.includes(dep) && dep !== '@money-kids/shared',
);
if (inlined.length > 0) {
  console.warn(
    `warning: ${inlined.join(', ')} will be inlined into the bundle. That is fine for pure JS, ` +
      'but native modules and dynamic requires must be added to EXTERNALS instead.',
  );
}

const pinned = Object.fromEntries(
  await Promise.all(EXTERNALS.map(async (dep) => [dep, await installedVersion(dep)])),
);

const manifest = {
  name: pkg.name,
  private: true,
  type: 'module',
  main: 'index.js',
  engines: pkg.engines,
  dependencies: pinned,
};
await writeFile(resolve(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Pinning the two externals only fixes the top level; without a lockfile the
// transitive tree floats, so two deploys of the same commit could ship
// different code underneath firebase-admin. The lockfile is committed so the
// tree is fixed by the commit rather than by whenever the script last ran.
if (refreshLock) {
  await execFileAsync('npm', ['install', '--package-lock-only', '--omit=dev', '--workspaces=false'], {
    cwd: outDir,
    shell: process.platform === 'win32', // npm is npm.cmd there
  });
  await copyFile(resolve(outDir, 'package-lock.json'), lockSrc);
  console.log(`refreshed ${relative(repoRoot, lockSrc)} — commit it`);
} else {
  let lock;
  try {
    lock = JSON.parse(await readFile(lockSrc, 'utf8'));
  } catch {
    fail(`missing ${relative(repoRoot, lockSrc)} — run: npm run stage:lock -w @money-kids/functions`);
  }
  // A lockfile that disagrees with the pinned manifest would make Cloud Build
  // fail `npm ci` at deploy time; catch it here instead.
  const drifted = EXTERNALS.filter((dep) => lock.packages?.[`node_modules/${dep}`]?.version !== pinned[dep]);
  if (drifted.length > 0) {
    fail(
      `${relative(repoRoot, lockSrc)} is stale for: ${drifted
        .map((d) => `${d} (lock ${lock.packages?.[`node_modules/${d}`]?.version ?? 'absent'} vs installed ${pinned[d]})`)
        .join(', ')}\nRefresh it: npm run stage:lock -w @money-kids/functions`,
    );
  }
  await copyFile(lockSrc, resolve(outDir, 'package-lock.json'));
}

console.log(
  `staged ${outDir} — self-contained, first-party only, ${declared.length} callables, pinned to ` +
    Object.entries(pinned)
      .map(([d, v]) => `${d}@${v}`)
      .join(', '),
);
