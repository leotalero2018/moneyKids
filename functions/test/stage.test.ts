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

  it('refuses when the money helpers are tree-shaken away', async () => {
    const dir = await makeFixture();
    await edit(indexIn(dir), () => 'export const ping = 1;\n');
    const { code, message } = await stage(dir);
    expect(code).toBe(1);
    expect(message).toContain('packages/shared/src/money.ts');
  });

  it('checks each required shared module individually, not in aggregate', async () => {
    const dir = await makeFixture();
    // A module that exists in shared but contributes nothing to the bundle.
    // An aggregate byte check would pass here, since money.ts and validate.ts
    // still contribute — which is exactly the gap this guard closes.
    await writeFile(resolve(dir, 'packages/shared/src/unused.ts'), 'export const unused = 1;\n');
    await edit(contractIn(dir), (s) => s.replace("'src/validate.ts']", "'src/validate.ts', 'src/unused.ts']"));
    const { code, message } = await stage(dir);
    expect(code).toBe(1);
    expect(message).toContain('packages/shared/src/unused.ts');
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
      lock.packages[''].dependencies['firebase-admin'] = '12.6.0';
      return JSON.stringify(lock);
    };
    await edit(lockIn(dir), stale);
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
