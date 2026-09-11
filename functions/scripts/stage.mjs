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
import {
  EXPECTED_CALLABLES,
  EXTERNALS,
  INLINED_WORKSPACE_PACKAGE,
  MONEY_CRITICAL_PACKAGES,
  REQUIRED_SHARED_MODULES,
  SHARED_MODULES_EXEMPT_FROM_BYTES,
} from './deploy-contract.mjs';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Guard violations are diagnostics for a human, not crashes — main() prints
// the message alone rather than a Node stack trace through this script. Both
// live at module scope so the catch below can actually see StagingError.
class StagingError extends Error {}
const fail = (msg) => {
  throw new StagingError(msg);
};

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = resolve(root, '..');
  const outDir = resolve(root, 'deploy');
  // Guards run after esbuild has already written output, so build into a temp
  // directory and promote it only once every check has passed. Otherwise a
  // failed build leaves a bundle with no manifest sitting in deploy/.
  const stageDir = resolve(root, '.deploy-staging');
  const lockSrc = resolve(root, 'deploy.lock.json');
  const refreshLock = process.argv.includes('--refresh-lock');
  // Version drift between the committed lock and the builder's node_modules only
  // matters when we are about to deploy. Under --strict (the predeploy hook) it
  // fails the build; otherwise it warns, so a routine `npm install` cannot break
  // the emulator and test loops.
  const strict = process.argv.includes('--strict');

  // Only these trees may contribute code to the bundle. Listed package by
  // package so that adding a workspace package does not silently make it
  // shippable into the functions runtime.
  const SHARED_SRC = resolve(repoRoot, 'packages/shared');
  const FIRST_PARTY = [resolve(root, 'src'), SHARED_SRC];

  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

  // True when `abs` is inside `dir`. Uses relative() rather than a '/' prefix
  // so this holds on Windows, where resolve() yields backslashes.
  const isInside = (dir, abs) => {
    const rel = relative(dir, abs);
    return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
  };

  // Reads the installed manifest off disk rather than require()-ing it: packages
  // with an `exports` map (firebase-admin among them) do not expose
  // ./package.json. npm hoists workspace deps to the repo root, but check the
  // package-local tree first in case a version conflict forced a nested copy.
  // NOTE: this pins to whatever is in the *builder's* node_modules, which the
  // root lockfile governs only if the builder ran `npm ci`. It probes only these
  // two trees, so a copy de-hoisted somewhere else by a version conflict would
  // be missed — that silently weakens the drift warning below, but the lock, not
  // this reading, is what actually determines the deployed version.
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

  // NOTE: the staged directory ships a manifest with no node_modules, so when
  // the emulator loads this bundle, `firebase-admin` and `firebase-functions`
  // resolve by walking up to the repo-root node_modules. That works because npm
  // hoists them, but it means the emulator uses different resolution than the
  // deployed function, which installs from the staged manifest. If a version
  // conflict ever de-hoists them, emulator startup breaks here first.
  //
  // Stale files in an existing deploy/ would be uploaded alongside the fresh
  // ones, so never build on top of a previous run.
  // .gitkeep is committed so the staged directory exists in a fresh clone.
  // Deploying after deleting functions/deploy does work today — firebase-tools
  // runs predeploy before validating functions.source — but that ordering is
  // undocumented, so this is belt-and-braces against it changing.
  await rm(stageDir, { recursive: true, force: true });
  // dist/ was the output before staging existed; sweep it so it does not linger
  // stale on machines that built an older revision.
  await rm(resolve(root, 'dist'), { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  const result = await build({
    entryPoints: [resolve(root, 'src/index.ts')],
    absWorkingDir: root, // makes metafile paths deterministic regardless of cwd
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: resolve(stageDir, 'index.js'),
    external: EXTERNALS,
    // Pin the workspace package to its path rather than letting node resolution
    // walk up to the root node_modules symlink. Guard 1 below would catch a
    // registry package winning that lookup, but pinning removes the possibility
    // rather than detecting it after the fact.
    //
    // This is the same file every other consumer resolves: packages/shared has
    // `main: "src/index.ts"`, no `exports` map and no build step, so typecheck
    // and vitest read exactly what gets bundled here. If shared ever gains a
    // dist/ build, this alias must follow it or CI would be testing different
    // money helpers than the ones deployed.
    // Aliased to the package directory, not to src/index.ts: esbuild applies
    // aliases to subpaths too, so pointing at a file would rewrite
    // `@money-kids/shared/money` to `.../src/index.ts/money` and fail.
    alias: { [INLINED_WORKSPACE_PACKAGE]: SHARED_SRC },
    sourcemap: true,
    metafile: true,
    banner: {
      // The Node 20 GCF runtime does not enable source maps by default, so the
      // emitted .map would be dead weight without this — a stack trace from a
      // money callable would point at generated code. This costs a little cold
      // start on every instance; accepted deliberately, because an unreadable
      // stack trace from a ledger write costs more.
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
        `Every bundled input must live in ${allowed}, and never under node_modules.\n` +
        'If packages/shared gained a runtime dependency, add it to EXTERNALS and to ' +
        'functions/package.json so Cloud Build installs it. Otherwise @money-kids/shared ' +
        'has stopped resolving to the local workspace package.',
    );
  }

  // 2. Nothing may escape the bundle except a declared external or a node
  // builtin — anything else is a module Cloud Build cannot install, which would
  // surface as a cold-start crash instead of a build failure.
  const allowedSpecifiers = new Set([...EXTERNALS, ...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
  // `firebase-admin/firestore` belongs to `firebase-admin`, so compare the
  // package name (scoped names keep two segments: `@scope/name`).
  const packageOf = (spec) =>
    spec
      .split('/')
      .slice(0, spec.startsWith('@') ? 2 : 1)
      .join('/');
  const escaped = Object.entries(result.metafile.outputs)
    // only the JS output can carry imports; whether the .map entry even has an
    // `imports` key varies by esbuild version, and this is the guard that must
    // not crash on itself
    .filter(([file]) => file.endsWith('.js'))
    // `external: true` is esbuild's own marker for an import it left unresolved,
    // which is more direct and version-stable than inspecting the specifier shape
    .flatMap(([, o]) => (o.imports ?? []).filter((i) => i.external).map((i) => i.path))
    .filter((p) => !allowedSpecifiers.has(packageOf(p)));
  if (escaped.length > 0) {
    fail(
      `bundle is not self-contained: ${[...new Set(escaped)].join(', ')}\n` +
        'Either inline it (remove from EXTERNALS) or, if it is published on npm, ' +
        'add it to EXTERNALS and to functions/package.json dependencies.',
    );
  }

  // 3. The shared money code must actually end up in the output. esbuild lists
  // an input it merely parsed, so checking that the file appears would pass even
  // if every export were tree-shaken away; bytesInOutput is what actually
  // shipped. Asserted from the metafile rather than by grepping for an
  // identifier, which would not survive renaming and would fail misleadingly on
  // an unrelated rename in shared.
  const contributed = Object.entries(result.metafile.outputs)
    .filter(([file]) => file.endsWith('.js'))
    .flatMap(([, o]) => Object.entries(o.inputs ?? {}))
    .reduce((acc, [file, info]) => {
      acc.set(resolve(root, file), info.bytesInOutput ?? 0);
      return acc;
    }, new Map());
  const exempt = new Set(SHARED_MODULES_EXEMPT_FROM_BYTES.map((m) => resolve(SHARED_SRC, m)));
  // Everything shared that esbuild parsed, plus the modules that must be there
  // whether or not anything currently imports them.
  // Candidates come from metafile.inputs (everything esbuild parsed), not from
  // the output's input map: a module tree-shaken to nothing is absent from the
  // latter entirely rather than present with zero bytes, so it would slip past.
  const sharedInputs = new Set([
    ...inputs.filter((abs) => isInside(SHARED_SRC, abs)),
    ...REQUIRED_SHARED_MODULES.map((m) => resolve(SHARED_SRC, m)),
  ]);
  const emptyShared = [...sharedInputs]
    .filter((abs) => !exempt.has(abs))
    .filter((abs) => !(contributed.get(abs) > 0))
    .map((abs) => relative(repoRoot, abs))
    .sort();
  if (emptyShared.length > 0) {
    fail(
      `no code survived into the bundle from: ${emptyShared.join(', ')}\n` +
        '@money-kids/shared resolved to a stub, or those helpers were tree-shaken away. ' +
        'Checking shared in aggregate would miss exactly this. If a module legitimately ' +
        'contributes nothing, add it to SHARED_MODULES_EXEMPT_FROM_BYTES.',
    );
  }

  // 4. The bundle's export surface must match the deploy contract exactly. A
  // callable that stops being exported deploys as a deleted function, which is
  // the failure mode that actually reaches families; an unexpected export means
  // the contract and the code have diverged.
  const exported = new Set(
    Object.entries(result.metafile.outputs)
      .filter(([file]) => file.endsWith('.js'))
      .flatMap(([, o]) => o.exports ?? []),
  );
  const missingCallables = EXPECTED_CALLABLES.filter((name) => !exported.has(name));
  const unexpected = [...exported].filter((name) => !EXPECTED_CALLABLES.includes(name));
  if (missingCallables.length > 0) {
    fail(
      `callables missing from the bundle: ${missingCallables.join(', ')}\n` +
        'Each would deploy as a deleted function. If this is intentional, remove it from ' +
        'EXPECTED_CALLABLES in scripts/deploy-contract.mjs.',
    );
  }
  if (unexpected.length > 0) {
    fail(
      `bundle exports callables not in the deploy contract: ${unexpected.join(', ')} — add them to EXPECTED_CALLABLES in scripts/deploy-contract.mjs`,
    );
  }

  // 5. Every external must be declared, so the generated manifest carries a real
  // version. The reverse is only a warning: a dependency that is not an external
  // gets inlined, which is usually what we want but breaks for native modules
  // and dynamic requires.
  for (const dep of EXTERNALS) {
    if (!pkg.dependencies?.[dep]) fail(`external missing from functions/package.json dependencies: ${dep}`);
  }
  const inlined = Object.keys(pkg.dependencies ?? {}).filter(
    (dep) => !EXTERNALS.includes(dep) && dep !== INLINED_WORKSPACE_PACKAGE,
  );
  if (inlined.length > 0) {
    console.warn(
      `warning: ${inlined.join(', ')} will be inlined into the bundle. That is fine for pure JS, ` +
        'but native modules and dynamic requires must be added to EXTERNALS instead.',
    );
  }

  if (!pkg.engines?.node)
    fail('functions/package.json has no engines.node — GCF would silently pick a default runtime');

  // The committed lock is the source of truth for what gets deployed: it is
  // fixed by the commit, whereas the builder's node_modules is whatever that
  // machine last installed. Pinning the manifest from the lock is what makes
  // "reproducible from the commit" actually true.
  let lock = null;
  if (!refreshLock) {
    try {
      lock = JSON.parse(await readFile(lockSrc, 'utf8'));
    } catch {
      fail(`missing ${relative(repoRoot, lockSrc)} — run: npm run stage:lock -w @money-kids/functions`);
    }
  }

  const pinned = Object.fromEntries(
    await Promise.all(
      EXTERNALS.map(async (dep) => {
        const installed = await installedVersion(dep);
        if (refreshLock) return [dep, installed];
        const locked = lock.packages?.[`node_modules/${dep}`]?.version;
        if (!locked) {
          fail(
            `${relative(repoRoot, lockSrc)} has no entry for ${dep} — ` +
              'run: npm run stage:lock -w @money-kids/functions',
          );
        }
        if (locked !== installed) {
          const msg =
            `${dep}: lock has ${locked}, node_modules has ${installed}. The deploy uses ${locked}.\n` +
            'Refresh with: npm run stage:lock -w @money-kids/functions';
          if (strict) fail(`refusing to deploy with a stale lock — ${msg}`);
          console.warn(`warning: ${msg}`);
        }
        return [dep, locked];
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
  await writeFile(resolve(stageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // Pinning the two externals only fixes the top level; without a lockfile the
  // transitive tree floats, so two deploys of the same commit could ship
  // different code underneath firebase-admin.
  if (refreshLock) {
    await execFileAsync('npm', ['install', '--package-lock-only', '--omit=dev', '--workspaces=false'], {
      cwd: stageDir,
      shell: process.platform === 'win32', // npm is npm.cmd there
    });
    await copyFile(resolve(stageDir, 'package-lock.json'), lockSrc);
    console.log(`refreshed ${relative(repoRoot, lockSrc)} — commit it`);
  } else {
    // The manifest and the lock ship together and Cloud Build runs npm ci
    // against the pair, which fails outright if they disagree. The added-dep
    // direction is caught above ("lock has no entry for X"); this catches the
    // removed-dep direction, where EXTERNALS shrinks and the lock still lists
    // the old root dependency set.
    const lockRoot = lock.packages?.['']?.dependencies ?? {};
    const describe = (o) =>
      Object.entries(o)
        .map(([d, v]) => `${d}@${v}`)
        .join(', ') || 'none';
    // Compare versions too, not just the key set: pinned is read from
    // packages['node_modules/<dep>'].version while this reads packages[''], and
    // a lock where those two disagree would sail past a keys-only check and
    // then fail inside Cloud Build's npm ci — the exact thing this pre-empts.
    const sameDeps =
      Object.keys(lockRoot).length === Object.keys(pinned).length &&
      Object.entries(pinned).every(([dep, version]) => lockRoot[dep] === version);
    if (!sameDeps) {
      fail(
        `${relative(repoRoot, lockSrc)} root dependencies [${describe(lockRoot)}] ` +
          `do not match the staged manifest [${describe(pinned)}]. ` +
          'npm ci would fail inside Cloud Build.\nRefresh: npm run stage:lock -w @money-kids/functions',
      );
    }
    await copyFile(lockSrc, resolve(stageDir, 'package-lock.json'));
  }

  // 8. The tree CI tests against and the tree production runs must agree on
  // the packages that carry a ledger write. The root lockfile and
  // deploy.lock.json resolve independently, so they can drift apart silently —
  // and a change in the Firestore client or the gRPC layer would then be
  // exercised by nothing before it reaches families.
  if (lock) {
    const rootLock = JSON.parse(await readFile(resolve(repoRoot, 'package-lock.json'), 'utf8'));
    const versionsOf = (packages, dep) => packages[`node_modules/${dep}`]?.version;
    const compared = [...new Set([...Object.keys(rootLock.packages), ...Object.keys(lock.packages)])]
      .filter((k) => k.startsWith('node_modules/'))
      .map((k) => k.slice('node_modules/'.length))
      .filter((dep) => versionsOf(rootLock.packages, dep) && versionsOf(lock.packages, dep))
      .map((dep) => ({
        dep,
        tested: versionsOf(rootLock.packages, dep),
        deployed: versionsOf(lock.packages, dep),
      }))
      .filter(({ tested, deployed }) => tested !== deployed);

    const critical = compared.filter(({ dep }) => MONEY_CRITICAL_PACKAGES.includes(dep));
    if (critical.length > 0) {
      fail(
        'the tested and deployed trees disagree on packages that carry a ledger write:\n' +
          critical.map(({ dep, tested, deployed }) => `  ${dep}: tests ${tested}, deploys ${deployed}`).join('\n') +
          '\nRefresh the staged lock (npm run stage:lock -w @money-kids/functions) or align the root lockfile.',
      );
    }
    if (compared.length > 0) {
      console.warn(
        `warning: ${compared.length} package(s) differ between the tested and deployed trees, none on the ` +
          `ledger path: ${compared.map(({ dep, tested, deployed }) => `${dep} ${tested}/${deployed}`).join(', ')}`,
      );
    }
  }

  // Everything passed: swap the staged directory into place. Move the old one
  // aside first rather than deleting it — predeploy has already pointed
  // firebase at functions.source, and a crash between an rm and a rename would
  // leave a mid-flight deploy with no source directory at all.
  const previous = `${outDir}.old`;
  await rm(previous, { recursive: true, force: true });
  const hadPrevious = await rename(outDir, previous).then(
    () => true,
    () => false, // absent on a first build
  );
  try {
    await rename(stageDir, outDir);
  } catch (e) {
    // Put the working artifact back rather than leaving no functions.source at
    // all — predeploy has already pointed firebase at this directory.
    if (hadPrevious) await rename(previous, outDir).catch(() => {});
    throw e;
  }
  await rm(previous, { recursive: true, force: true });
  // Committed so the staged directory exists in a fresh clone; firebase.json's
  // functions.ignore keeps it out of the upload.
  await writeFile(resolve(outDir, '.gitkeep'), '');

  console.log(
    `staged ${outDir} — self-contained, first-party only, ${EXPECTED_CALLABLES.length} callables, pinned to ` +
      Object.entries(pinned)
        .map(([d, v]) => `${d}@${v}`)
        .join(', '),
  );
}

main().catch(async (e) => {
  // Never leave partial staging directories behind for a later step to find.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  await rm(resolve(here, '.deploy-staging'), { recursive: true, force: true }).catch(() => {});
  // deploy.old is only debris while deploy/ exists. If both the promote and the
  // restore failed, it is the ONLY complete artifact left and deleting it would
  // leave functions.source missing mid-deploy — the exact thing the promote
  // dance exists to prevent.
  if (existsSync(resolve(here, 'deploy'))) {
    await rm(resolve(here, 'deploy.old'), { recursive: true, force: true }).catch(() => {});
  }
  console.error(e instanceof StagingError ? `Error: ${e.message}` : e);
  process.exit(1);
});
