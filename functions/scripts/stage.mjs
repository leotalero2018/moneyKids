// Builds the artifact that Cloud Build actually installs.
//
// Cloud Build runs `npm install` inside `functions.source` in isolation from
// the npm workspace, so it cannot resolve `@money-kids/shared` — that package
// is local and unpublished. esbuild already inlines it, so it is a build-time
// dependency only. Rather than delete it from functions/package.json (which
// would leave src/ importing a package no manifest declares), we emit a
// staging directory whose generated manifest lists only the runtime externals.
// functions/package.json stays honest for local dev, typecheck and vitest.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'deploy');
const outFile = resolve(outDir, 'index.js');

// Anything NOT in this list must be inlined into the bundle. Adding an entry
// here means Cloud Build has to install it, so it must be a published package.
const EXTERNALS = ['firebase-admin', 'firebase-functions'];

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

await mkdir(outDir, { recursive: true });
const result = await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: outFile,
  external: EXTERNALS,
  metafile: true,
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});

// Everything inlined must be first-party source. `@money-kids/shared` carries
// the minor-unit money helpers, and it resolves through the workspace symlink
// in the ROOT node_modules — nothing in functions/ pins that resolution. If it
// ever resolved to a same-named package from a registry, the bundle would
// still be self-contained and the build would stay green while inlining the
// wrong money code. Requiring every input to live in this repo makes that
// substitution a build failure instead of a silent money bug.
const foreign = Object.keys(result.metafile.inputs).filter((f) => f.includes('node_modules'));
if (foreign.length > 0) {
  throw new Error(
    `bundle inlines code from node_modules: ${foreign.slice(0, 5).join(', ')}` +
      `${foreign.length > 5 ? ` (+${foreign.length - 5} more)` : ''}\n` +
      'Every bundled input must be first-party source (functions/src or packages/*). ' +
      'Check that @money-kids/shared still resolves to the local workspace package.',
  );
}

// The whole deploy rests on the bundle being self-contained. Prove it from
// esbuild's own metafile rather than trusting that the externals list is
// still accurate: any bare import that survived bundling and is neither a
// declared external nor a node builtin would be a module Cloud Build cannot
// install, and the deploy would fail at cold start instead of here.
const allowed = new Set([...EXTERNALS, ...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
// `firebase-admin/firestore` belongs to the `firebase-admin` package, so
// compare the package name, not the full specifier (scoped names keep two
// segments: `@scope/name`).
const packageOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
const escaped = [...Object.values(result.metafile.outputs)]
  .flatMap((o) => o.imports.map((i) => i.path))
  .filter((p) => !p.startsWith('.') && !p.startsWith('/') && !allowed.has(packageOf(p)));
if (escaped.length > 0) {
  throw new Error(
    `bundle is not self-contained: ${[...new Set(escaped)].join(', ')}\n` +
      'Either inline it (remove from EXTERNALS) or, if it is published on npm, ' +
      'add it to EXTERNALS and to the generated manifest below.',
  );
}

// Each external has to be installable by Cloud Build, which reads only the
// generated manifest — so it needs a real version range from our own deps.
const undeclared = EXTERNALS.filter((d) => !pkg.dependencies?.[d]);
if (undeclared.length > 0) {
  throw new Error(`external(s) missing from functions/package.json dependencies: ${undeclared.join(', ')}`);
}

// Minimal manifest: only what Cloud Build must install at runtime.
const manifest = {
  name: pkg.name,
  private: true,
  type: 'module',
  main: 'index.js',
  engines: pkg.engines,
  dependencies: Object.fromEntries(EXTERNALS.map((d) => [d, pkg.dependencies[d]])),
};
await writeFile(resolve(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`staged ${outFile} (${EXTERNALS.length} runtime deps, bundle self-contained)`);
