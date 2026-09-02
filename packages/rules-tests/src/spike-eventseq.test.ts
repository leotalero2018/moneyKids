import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

const here = dirname(fileURLToPath(import.meta.url));
let env: RulesTestEnvironment;

beforeAll(async () => {
  // initializeTestEnvironment throws if the rules fail to COMPILE — that alone
  // is the answer to "is a computed path segment valid interpolation?"
  env = await initializeTestEnvironment({
    projectId: 'money-kids-test',
    firestore: { rules: readFileSync(resolve(here, 'spike-eventseq.rules'), 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'target/t1'), { n: 0 });
    await setDoc(doc(db, 'probe/x1'), { hit: true }); // x1 exists, x2 does not
  });
});

describe('computed path segments in existsAfter', () => {
  it('compiles (proven by beforeAll not throwing) and resolves true for an existing target', async () => {
    const db = env.authenticatedContext('u1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'target/t1'), { n: 1 }));
  });

  it('denies when the computed target is missing', async () => {
    const db = env.authenticatedContext('u1').firestore();
    await assertFails(updateDoc(doc(db, 'target/t1'), { n: 2 }));
  });

  it('documents that a missing existsAfter target denies via EVALUATION ERROR, not clean false', async () => {
    // This is why Task 6's negative tests must be paired with positive ones: a
    // denial is indistinguishable from a broken rule expression. Asserted here
    // once, so the paired-assertion discipline in Task 6 has a stated reason.
    const db = env.authenticatedContext('u1').firestore();
    const err = await updateDoc(doc(db, 'target/t1'), { n: 2 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/evaluation error|PERMISSION_DENIED/i);
  });
});
