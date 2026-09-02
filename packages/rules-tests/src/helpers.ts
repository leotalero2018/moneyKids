import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export async function setupTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: 'money-kids-test',
    firestore: { rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8') },
    storage: { rules: readFileSync(resolve(root, 'storage.rules'), 'utf8') },
  });
}

export function parentCtx(env: RulesTestEnvironment, uid: string): RulesTestContext {
  return env.authenticatedContext(uid);
}

export function kidCtx(env: RulesTestEnvironment, familyId: string, kidId: string): RulesTestContext {
  return env.authenticatedContext(`kid_${familyId}_${kidId}`, { role: 'kid', familyId, kidId });
}

export async function seed(
  env: RulesTestEnvironment,
  fn: (ctx: RulesTestContext) => Promise<void>,
): Promise<void> {
  await env.withSecurityRulesDisabled(fn);
}
