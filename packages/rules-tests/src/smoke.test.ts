import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import { setupTestEnv, parentCtx } from './helpers.js';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.cleanup(); });

describe('deny-all skeleton', () => {
  it('denies arbitrary reads', async () => {
    const db = parentCtx(env, 'p1').firestore();
    await expect(assertFails(getDoc(doc(db, 'anything/doc1')))).resolves.toBeDefined();
  });
});
