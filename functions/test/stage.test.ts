// The staging guards are the only thing between a subtly wrong bundle and
// production — a tree-shaken money helper, a callable that stopped being
// exported, a lockfile that disagrees with the manifest. Verifying them by
// hand-seeding violations in the working tree is not acceptable for files that
// hold the invoice-approval path: a crash mid-run would leave the money
// callables replaced by a stub.
//
// So every test copies functions/ and packages/shared into a tmpdir, mutates
// the copy, and runs the real stage.mjs there. Nothing in the repo is touched.
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const functionsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(functionsRoot, '..');

let fixture: string | undefined;

/**
 * A throwaway copy of the workspace, laid out the way stage.mjs expects:
 * <root>/functions and <root>/packages/shared, with node_modules symlinked
 * back to the real install so esbuild and the version probe still resolve.
 */
async function makeFixture(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'money-kids-stage-'));
  const skip = (src: string) => !/node_modules|[/\\](deploy|\.deploy-staging)([/\\]|$)/.test(src);
  await cp(functionsRoot, resolve(dir, 'functions'), { recursive: true, filter: skip });
  await cp(resolve(repoRoot, 'packages/shared'), resolve(dir, 'packages/shared'), {
    recursive: true,
    filter: skip,
  });
  // guard 8 compares the staged lock against the root lockfile
  await cp(resolve(repoRoot, 'package-lock.json'), resolve(dir, 'package-lock.json'));
  await symlink(resolve(repoRoot, 'node_modules'), resolve(dir, 'node_modules'), 'dir');
  fixture = dir;
  return dir;
}

const contractIn = (dir: string) => resolve(dir, 'functions/scripts/deploy-contract.mjs');
const lockIn = (dir: string) => resolve(dir, 'functions/deploy.lock.json');
const indexIn = (dir: string) => resolve(dir, 'functions/src/index.ts');

async function edit(file: string, mutate: (text: string) => string): Promise<void> {
  await writeFile(file, mutate(await readFile(file, 'utf8')));
}

/** Runs the real staging script inside the fixture. */
async function stage(dir: string, ...args: string[]): Promise<{ code: number; message: string }> {
  try {
    // warnings land on stderr on the success path too, so keep it either way
    const { stderr } = await execFileAsync('node', ['scripts/stage.mjs', ...args], {
      cwd: resolve(dir, 'functions'),
    });
    return { code: 0, message: stderr };
  } catch (e) {
    const err = e as { code?: number; stderr?: string };
    return { code: err.code ?? 1, message: err.stderr ?? '' };
  }
}

afterEach(async () => {
  if (fixture) await rm(fixture, { recursive: true, force: true });
  fixture = undefined;
});

describe('staging guards', () => {
  it('stages a complete artifact when nothing is wrong', async () => {
    const dir = await makeFixture();
    const { code, message } = await stage(dir);
    expect(code).toBe(0);
    expect(message).not.toContain('Error');
    for (const file of ['index.js', 'index.js.map', 'package.json', 'package-lock.json']) {
      expect(existsSync(resolve(dir, 'functions/deploy', file))).toBe(true);
    }
  });

  it('refuses when a callable is missing from the bundle', async () => {
    const dir = await makeFixture();
    await edit(contractIn(dir), (s) => s.replace("'recordPayout',", "'recordPayout',\n  'ghostCallable',"));
    const { code, message } = await stage(dir);
    expect(code).toBe(1);
    expect(message).toContain('callables missing from the bundle: ghostCallable');
  });

  it('refuses when the bundle exports something outside the contract', async () => {
    const dir = await makeFixture();
    await edit(contractIn(dir), (s) => s.replace("  'recordPayout',\n", ''));
    const { code, message } = await stage(dir);
    expect(code).toBe(1);
    expect(message).toContain('not in the deploy contract: recordPayout');
  });

  it('refuses when a shared module reaches the bundle but is tree-shaken to nothing', async () => {
    const dir = await makeFixture();
    // A new shared module that nothing calls. It reaches metafile.inputs via
    // the barrel but contributes zero bytes — an aggregate check would pass,
    // since money.ts and validate.ts still contribute. This is the case the
    // inverted guard catches without anyone remembering to list the file.
    await writeFile(resolve(dir, 'packages/shared/src/deductions.ts'), 'export const unusedHelper = () => 1;\n');
    await edit(resolve(dir, 'packages/shared/src/index.ts'), (s) => `export * from './deductions';\n${s}`);
    const { code, message } = await stage(dir);
    expect(code).toBe(1);
    expect(message).toContain('packages/shared/src/deductions.ts');
  });

  it('refuses when money.ts is gone even if nothing imports it any more', async () => {
    const dir = await makeFixture();
    // money.ts is in REQUIRED_SHARED_MODULES, so it is checked whether or not
    // anything currently pulls it in: deleting the last caller must not
    // quietly drop the minor-unit arithmetic from the bundle.
    await edit(indexIn(dir), () => 'export const ping = 1;\n');
    const { code, message } = await stage(dir);
    expect(code).toBe(1);
    expect(message).toContain('packages/shared/src/money.ts');
  });

  it('refuses when an external is not declared for Cloud Build', async () => {
    const dir = await makeFixture();
    await edit(contractIn(dir), (s) => s.replace("'firebase-functions'];", "'firebase-functions', 'zod'];"));
    const { code, message } = await stage(dir);
    expect(code).toBe(1);
    expect(message).toContain('external missing from functions/package.json dependencies: zod');
  });

  it('refuses when engines.node is absent', async () => {
    const dir = await makeFixture();
    await edit(resolve(dir, 'functions/package.json'), (s) => {
      const pkg = JSON.parse(s);
      delete pkg.engines;
      return JSON.stringify(pkg, null, 2);
    });
    const { code, message } = await stage(dir);
    expect(code).toBe(1);
    expect(message).toContain('no engines.node');
  });

  it('refuses when foreign code would be inlined', async () => {
    const dir = await makeFixture();
    await edit(contractIn(dir), (s) =>
      s.replace(/export const EXTERNALS = \[[^\]]*\];/, 'export const EXTERNALS = [];'),
    );
    const { code, message } = await stage(dir);
    expect(code).toBe(1);
    expect(message).toContain('outside first-party source');
  });

  it('refuses when an import escapes the bundle unresolved', async () => {
    const dir = await makeFixture();
    // Guard 2 is unreachable in the current configuration — esbuild externalises
    // exactly EXTERNALS plus node builtins, so nothing else can escape. It is a
    // tripwire for a future `packages: 'external'` or `external` change, so this
    // simulates that by externalising something Cloud Build could not install.
    await edit(resolve(dir, 'functions/scripts/stage.mjs'), (s) =>
      s.replace('external: EXTERNALS,', "external: [...EXTERNALS, 'node-fetch'],"),
    );
    await edit(indexIn(dir), (s) => `import 'node-fetch';\n${s}`);
    const { code, message } = await stage(dir);
    expect(code).toBe(1);
    expect(message).toContain('not self-contained');
    expect(message).toContain('node-fetch');
  });

  it('warns, but does not fail, when the tested and deployed trees diverge on the ledger path', async () => {
    const dir = await makeFixture();
    // The root lockfile governs what test:functions runs against; the staged
    // lock governs production. Divergence here means the suite guarding the
    // money callables is not exercising the code that runs them — worth
    // shouting about, but not a failure: the two lockfiles resolve
    // independently, so failing would deadlock the refresh workflow whose job
    // is to move the deployed tree.
    await edit(lockIn(dir), (s) => {
      const lock = JSON.parse(s);
      lock.packages['node_modules/@google-cloud/firestore'].version = '0.0.1';
      return JSON.stringify(lock);
    });
    const { code, message } = await stage(dir);
    expect(code).toBe(0);
    expect(message).toContain('carry a ledger write');
    expect(message).toContain('@google-cloud/firestore');

    // and still not a failure under --strict, deliberately
    const strict = await stage(dir, '--strict');
    expect(strict.code).toBe(0);
    expect(strict.message).toContain('carry a ledger write');
  });

  it('refuses when the committed lock disagrees with the manifest', async () => {
    const dir = await makeFixture();
    await edit(lockIn(dir), (s) => {
      const lock = JSON.parse(s);
      lock.packages[''].dependencies['firebase-admin'] = '0.0.1';
      return JSON.stringify(lock);
    });
    const { code, message } = await stage(dir);
    expect(code).toBe(1);
    expect(message).toContain('do not match the staged manifest');
  });

  it('only warns about lock drift without --strict, and fails with it', async () => {
    const dir = await makeFixture();
    const stale = (s: string) => {
      const lock = JSON.parse(s);
      lock.packages['node_modules/firebase-admin'].version = '12.6.0';
      if (lock.packages['']?.dependencies) lock.packages[''].dependencies['firebase-admin'] = '12.6.0';
      return JSON.stringify(lock);
    };
    await edit(lockIn(dir), stale);
    // Move the root lockfile too, so guard 8 stays satisfied and this test
    // isolates lock-versus-installed drift rather than tested-versus-deployed.
    await edit(resolve(dir, 'package-lock.json'), stale);
    const lenient = await stage(dir);
    expect(lenient.code).toBe(0);
    expect(lenient.message).toContain('warning:');

    const strict = await stage(dir, '--strict');
    expect(strict.code).toBe(1);
    expect(strict.message).toContain('refusing to deploy with a stale lock');
  });

  it('leaves the previous artifact intact and no debris when a guard fails', async () => {
    const dir = await makeFixture();
    expect((await stage(dir)).code).toBe(0);

    await edit(contractIn(dir), (s) => s.replace("'recordPayout',", "'recordPayout',\n  'ghostCallable',"));
    expect((await stage(dir)).code).toBe(1);

    const deploy = resolve(dir, 'functions/deploy');
    expect(existsSync(resolve(deploy, 'index.js'))).toBe(true);
    const manifest = JSON.parse(await readFile(resolve(deploy, 'package.json'), 'utf8'));
    expect(manifest.dependencies['firebase-admin']).toBeTruthy();
    expect(existsSync(resolve(dir, 'functions/.deploy-staging'))).toBe(false);
    expect(existsSync(`${deploy}.old`)).toBe(false);
  });
});
