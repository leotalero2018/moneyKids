// The staging guards are the only thing standing between a subtly wrong bundle
// and production — a tree-shaken money helper, a callable that stopped being
// exported, a lockfile that disagrees with the manifest. They were previously
// verified by hand-seeding violations, which meant a regression in a guard
// itself would have been invisible. These tests seed each violation and assert
// the build refuses.
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const functionsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = resolve(functionsRoot, 'scripts/deploy-contract.mjs');
const lock = resolve(functionsRoot, 'deploy.lock.json');
const backups = new Map<string, string>();

async function edit(file: string, mutate: (text: string) => string): Promise<void> {
  const original = await readFile(file, 'utf8');
  if (!backups.has(file)) backups.set(file, original);
  await writeFile(file, mutate(original));
}

/** Runs the real staging script and returns what it printed and exited with. */
async function stage(): Promise<{ code: number; message: string }> {
  try {
    await execFileAsync('node', ['scripts/stage.mjs'], { cwd: functionsRoot });
    return { code: 0, message: '' };
  } catch (e) {
    const err = e as { code?: number; stderr?: string };
    return { code: err.code ?? 1, message: err.stderr ?? '' };
  }
}

// These tests seed violations by editing real files in the repo and restoring
// them afterwards. If a run is killed mid-test, `git checkout functions/` puts
// everything back — nothing here writes outside functions/.
afterEach(async () => {
  try {
    for (const [file, original] of backups) await writeFile(file, original);
  } finally {
    backups.clear();
    // Leave a valid artifact behind: other suites and the emulator load it.
    await execFileAsync('node', ['scripts/stage.mjs'], { cwd: functionsRoot });
  }
});

describe('staging guards', () => {
  it('stages a bundle with every callable when nothing is wrong', async () => {
    const { code } = await stage();
    expect(code).toBe(0);
  });

  it('refuses to stage when a callable is missing from the bundle', async () => {
    await edit(contract, (s) => s.replace("'recordPayout',", "'recordPayout',\n  'ghostCallable',"));
    const { code, message } = await stage();
    expect(code).toBe(1);
    expect(message).toContain('callables missing from the bundle: ghostCallable');
  });

  it('refuses to stage when the bundle exports something outside the contract', async () => {
    await edit(contract, (s) => s.replace("  'recordPayout',\n", ''));
    const { code, message } = await stage();
    expect(code).toBe(1);
    expect(message).toContain('not in the deploy contract: recordPayout');
  });

  it('refuses to stage when the money helpers are tree-shaken away', async () => {
    const index = resolve(functionsRoot, 'src/index.ts');
    await edit(index, () => 'export const ping = 1;\n');
    const { code, message } = await stage();
    expect(code).toBe(1);
    expect(message).toContain('no code from packages/shared survived');
  });

  it('refuses to stage when an external is not declared for Cloud Build', async () => {
    await edit(contract, (s) => s.replace("'firebase-functions'];", "'firebase-functions', 'zod'];"));
    const { code, message } = await stage();
    expect(code).toBe(1);
    expect(message).toContain('external missing from functions/package.json dependencies: zod');
  });

  it('refuses to stage when the committed lock disagrees with the manifest', async () => {
    await edit(lock, (s) => {
      const parsed = JSON.parse(s);
      parsed.packages[''].dependencies['firebase-admin'] = '0.0.1';
      return JSON.stringify(parsed);
    });
    const { code, message } = await stage();
    expect(code).toBe(1);
    expect(message).toContain('do not match the staged manifest');
  });

  it('leaves the previous artifact intact when a guard fails', async () => {
    await edit(contract, (s) => s.replace("'recordPayout',", "'recordPayout',\n  'ghostCallable',"));
    expect((await stage()).code).toBe(1);
    // A failed build must not leave deploy/ half-written for a deploy to pick up
    const manifest = JSON.parse(await readFile(resolve(functionsRoot, 'deploy/package.json'), 'utf8'));
    expect(manifest.dependencies['firebase-admin']).toBeTruthy();
  });
});
