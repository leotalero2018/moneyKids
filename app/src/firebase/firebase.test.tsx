import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { doc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../firebase.js';
import { FirebaseProvider } from './FirebaseContext.js';
import { useDoc } from '../hooks/useDoc.js';
import { clearFirestoreData, signInTestParent } from '../test/emulator.js';
import type { ReactNode } from 'react';

// kidBundle() rather than a frozen import: Task 11 replaces the kid instance
// when the kid identity changes, so a module-level const would go stale.
// This file never resets, so binding once here is safe.
const kidFb = kidBundle();

beforeAll(async () => {
  // sign BOTH out first, then sign the parent in: this test asserts the kid
  // instance is anonymous, and that must not depend on which tests ran before
  // it. (Cross-file leakage is already unlikely — vitest isolates modules per
  // file and jsdom has no localStorage, so Firebase Auth falls back to
  // in-memory persistence — but within-file order and future edits are real.)
  await signOut(parentFb.auth);
  await signOut(kidFb.auth);
  await signInTestParent('twoinst');
});
beforeEach(async () => { await clearFirestoreData(); });

describe('two Firebase instances', () => {
  it('are distinct apps with independent auth state', async () => {
    expect(parentFb.app.name).not.toBe(kidFb.app.name);
    // the parent is signed in; the kid instance must NOT inherit that user
    expect(parentFb.auth.currentUser).not.toBeNull();
    expect(kidFb.auth.currentUser).toBeNull();
  });

  it('useDoc reads through whichever instance the context supplies', async () => {
    const uid = parentFb.auth.currentUser!.uid;
    const batch = writeBatch(parentFb.db);
    batch.set(doc(parentFb.db, 'families/famT'), {
      name: 'Talero', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
    });
    batch.set(doc(parentFb.db, 'families/famT/members', uid), {
      role: 'parent', displayName: 'Leo',
    });
    await batch.commit();

    // no provider: the default bundle is the parent, so this still works and
    // every existing parent screen keeps compiling unchanged
    const bare = renderHook(() => useDoc<{ name: string }>('families/famT'));
    await waitFor(() => expect(bare.result.current.data?.name).toBe('Talero'));

    // through the kid instance (signed out) the same read is denied, which
    // proves the hook is really using the supplied instance
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FirebaseProvider value={kidFb}>{children}</FirebaseProvider>
    );
    const viaKid = renderHook(() => useDoc('families/famT'), { wrapper });
    // the hook retries a denial a few times before surfacing it, in case it
    // is the transient kind, so this needs longer than the 1s default
    await waitFor(
      () => expect(viaKid.result.current.error).toBeInstanceOf(Error), { timeout: 8000 },
    );
  });

  it('signing out one instance leaves the other alone', async () => {
    await signOut(kidFb.auth);
    expect(parentFb.auth.currentUser).not.toBeNull();
  });

  it('each instance gets its own cache, so the two sessions cannot collide', () => {
    // distinct app names key distinct IndexedDB databases; if these were the
    // same app, the kid's cached documents and the parent's would share one
    expect(parentFb.db).not.toBe(kidFb.db);
    expect(parentFb.app.name).not.toBe(kidFb.app.name);
  });
});
