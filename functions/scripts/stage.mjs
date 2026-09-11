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
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '..');
const outDir = resolve(root, 'deploy');

// Anything NOT listed here must be inlined into the bundle. Adding an entry
// means Cloud Build has to install it, so it must be published on npm.
const EXTERNALS = ['firebase-admin', 'firebase-functions'];

// Only these trees may contribute code to the bundle.
const FIRST_PARTY = [resolve(root, 'src'), resolve(repoRoot, 'packages')];

// A symbol that must survive bundling, to catch `shared` resolving to a stub
// or being tree-shaken away entirely.
const SHARED_SENTINEL = 'MINOR_DIGITS';

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

// Read the installed manifest off disk rather than require()-ing it: packages
// with an `exports` map (firebase-admin among them) do not expose
// ./package.json. npm hoists workspace deps to the repo root, but check the
// package-local tree first in case a version conflict forced a nested copy.
async function installedVersion(dep) {
  for (const base of [resolve(root, 'node_modules'), resolve(repoRoot, 'node_modules')]) {
    try {
      const { version } = JSON.parse(await readFile(resolve(base, dep, 'package.json'), 'utf8'));
      if (version) return version;
    } catch {
      // not installed in this tree; try the next one
    }
  }
  throw new Error(`cannot resolve an installed version for ${dep} — run npm install`);
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
  sourcemap: true, // exceptions in a money callable must map to real source
  metafile: true,
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});

const fail = (msg) => {
  throw new Error(msg);
};

// 1. Every bundled input must come from first-party source. `shared` carries
// the minor-unit money helpers and resolves through the workspace symlink in
// the ROOT node_modules — nothing in functions/ pins that resolution. If a
// same-named package from a registry ever won, the bundle would still be
// self-contained and the build would stay green while inlining the wrong
// money code. Asserting the positive (paths under functions/src or packages/)
// rather than the absence of `node_modules` keeps this working under
// preserveSymlinks and whatever cwd the script is invoked from.
const foreign = Object.keys(result.metafile.inputs)
  .map((f) => resolve(root, f))
  .filter((abs) => !FIRST_PARTY.some((dir) => abs.startsWith(`${dir}/`)));
if (foreign.length > 0) {
  fail(
    `bundle inlines code from outside first-party source: ${foreign.slice(0, 5).join(', ')}` +
      `${foreign.length > 5 ? ` (+${foreign.length - 5} more)` : ''}\n` +
      'Every bundled input must live in functions/src or packages/. Check that ' +
      '@money-kids/shared still resolves to the local workspace package.',
  );
}

// 2. Nothing may escape the bundle except a declared external or a node
// builtin — anything else is a module Cloud Build cannot install, which would
// surface as a cold-start crash instead of a build failure.
const allowed = new Set([...EXTERNALS, ...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
// `firebase-admin/firestore` belongs to `firebase-admin`, so compare the
// package name (scoped names keep two segments: `@scope/name`).
const packageOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
const escaped = [...Object.values(result.metafile.outputs)]
  .flatMap((o) => o.imports.map((i) => i.path))
  .filter((p) => !p.startsWith('./') && !p.startsWith('../') && !allowed.has(packageOf(p)));
if (escaped.length > 0) {
  fail(
    `bundle is not self-contained: ${[...new Set(escaped)].join(', ')}\n` +
      'Either inline it (remove from EXTERNALS) or, if it is published on npm, ' +
      'add it to EXTERNALS and to functions/package.json dependencies.',
  );
}

// 3. The shared money code must actually be in the output.
const bundled = await readFile(resolve(outDir, 'index.js'), 'utf8');
if (!bundled.includes(SHARED_SENTINEL)) {
  fail(`bundle is missing ${SHARED_SENTINEL} from @money-kids/shared — it resolved to a stub or was tree-shaken`);
}

// 4. Pin externals to the versions actually installed here. Cloud Build gets
// no lockfile, so a caret range would let two deploys of the same commit ship
// different firebase-admin minors — the SDK that stands between a callable
// and the ledger should not drift between deploys.
const pinned = Object.fromEntries(
  await Promise.all(
    EXTERNALS.map(async (dep) => {
      if (!pkg.dependencies?.[dep]) fail(`external missing from functions/package.json dependencies: ${dep}`);
      return [dep, await installedVersion(dep)];
    }),
  ),
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
console.log(
  `staged ${outDir} — self-contained, first-party only, pinned to ` +
    Object.entries(pinned)
      .map(([d, v]) => `${d}@${v}`)
      .join(', '),
);
