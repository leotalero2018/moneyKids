# Money Kids — Plan 3: Kid Experience & Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the kid-facing half of the PWA — join a family with a code, browse ways to earn, build and send an invoice with photos, negotiate a counter-offer, and watch a balance grow — across the spec's three age modes, plus the polish that makes it a real app: offline drafts, installability, and an end-to-end test of the whole invoice loop.

**Architecture:** The app grows a **second Firebase instance**. A parent session and a kid session must both be live on one device (a kid borrowing a parent's phone still needs a *kid* token to write an invoice — the rules reject a parent writing one), and Firebase Auth holds one user per app instance, so `initializeApp` is called twice under distinct names and the UI reads whichever instance is active from React context. Kid screens are the same components at every age; **age modes are CSS token overrides** on a `data-age-mode` attribute, with one behavioral exception the tokens cannot express (5–8 builds invoices from photos instead of typing). Money mutations still go only through Plan 1's callables.

**Tech Stack:** Everything Plan 2 uses, plus `vite-plugin-pwa` (manifest + service worker) and `@playwright/test` (mobile-viewport e2e). Photo compression is hand-rolled on a `<canvas>` — no image library.

**Spec:** `docs/superpowers/specs/2026-07-31-money-kids-design.md`

**Predecessors:** `docs/superpowers/plans/2026-07-31-money-engine.md` (Plan 1) and `docs/superpowers/plans/2026-09-02-parent-experience.md` (Plan 2), both complete and merged to `main`.

## Decisions taken into this plan

Recorded so a reviewer knows these were chosen, not overlooked:

- **Two named Firebase app instances.** The alternative — one session, where entering kid mode signs the parent out — would make the spec's parent PIN decorative, since returning to the parent view would need a full sign-in anyway.
- **Manual join-code entry, no QR scan.** A camera scanner needs two dependencies, camera permissions, and a flow Playwright cannot drive headlessly. The parent screen already shows the 8-character code as text; QR display and scanning are a fast-follow.
- **All three age modes**, as token overrides. Note the limit honestly: tokens scale type, tap targets, and density, but "photo instead of typing" for 5–8 is a *behavioral* difference, so the invoice builder branches on mode for that one screen (Task 6). Everything else is tokens.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-money-kids-design.md`. Every invariant below is copied from it or from the shipped code of Plans 1–2.
- **All money is integer minor units**, formatted only through `<Money>` / `formatMinor` and parsed only through `parseMajor`. A kid setting their own price goes through the same parser as the parent's counter-offer.
- **A kid session is a custom-token session.** `mintKidToken` returns a token for uid `kid_{familyId}_{kidId}` with claims `{ familyId, kidId, role: 'kid' }`; the client signs in with `signInWithCustomToken` **on the kid app instance**. Claims are the only source of `familyId`/`kidId` — never trust a value from the UI.
- **Kid writes the rules permit, and nothing else:** create an invoice only as `status: 'draft'`, `eventCount: 0`, `createdAt == request.time`, `kidId` equal to their own claim, exactly the eight whitelisted keys, `description` ≤ 1000, `photoPaths` a list of ≤ 8; edit only in `draft | returned | countered`, and only `description`, `photoPaths`, `requestedAmount` (plus `activityId` in `draft`); delete only a `draft`. Everything else is denied, including any write to `approved`.
- **Every transition is a batch with its event**, at the deterministic id `e{newEventCount}`: `{ from, to, actorUid, at, note?, requestedAmount?, kidId }`, `actorUid` the caller's uid, `at` `serverTimestamp()`, `from` the pre-batch status, `from != to`. **`requestedAmount` is required on every `→ sent` event** and forbidden elsewhere.
- **Kid reads must be rule-shaped.** Rules do not filter queries: a kid may only query `invoices` and `ledger` constrained by `kidId == own claim`, may `get` their own `kids/{kidId}` doc and the family doc, and may read `activities`. An unconstrained query **fails outright** rather than returning a subset.
- **Photos:** Storage path `families/{familyId}/kids/{kidId}/invoices/{invoiceId}/{fileName}`, `image/*`, ≤ 5 MB per file, ≤ 8 per invoice (enforced on `photoPaths` in Firestore). The Storage rule reads the linked invoice, so **the invoice document must exist server-side before an upload** and must still be in a kid-editable status.
- **Drafts are documents, created before any upload**, so work survives a lost device and Storage has something to authorize against.
- **Bilingual, always.** Every string comes from `react-i18next` with matching `es`/`en` keys (the key-parity test enforces it). Kid copy is playful but never babyish — the app treats a kid as a professional sending real invoices.
- **Assert Firestore state with `getDocFromServer` / `getDocsFromServer`**, never plain `getDoc`: a cached read is satisfied by a locally buffered write and passes before the server has it.
- **`clearFirestoreData()` awaits `waitForPendingWrites` first**, on **both** instances once Task 1 lands — unacknowledged writes are otherwise replayed after the wipe and reappear in the next test.
- **Wrap a screen in a session provider only if it uses that session.** A provider around a screen that does not need it subscribes to documents the current user may not read yet, surfacing as an unattributable `FirebaseError`.
- Node ≥ 20.11, TypeScript `strict: true`, `typecheck` in every workspace, run in every task's verification. Component tests run under `firebase emulators:exec`.
- Commit after every task (steps say when).

---

## File Structure

**Refactored in place (Task 1):**

| File | Change |
|---|---|
| `app/src/firebase.ts` | Two named apps; exports `parentFb` and `kidFb` bundles, plus the existing `auth`/`db`/`fns`/`storage` names bound to the parent bundle so no parent code changes |
| `app/src/firebase/FirebaseContext.tsx` | `<FirebaseProvider value={bundle}>` and `useFirebase()`; the default value is the parent bundle |
| `app/src/hooks/useDoc.ts`, `useCollection.ts` | Read `db` from `useFirebase()` instead of importing the singleton |
| `app/src/lib/callables.ts` | Callables become factories over a bundle, so a kid session calls them with kid credentials |
| `app/src/lib/invoiceActions.ts` | Takes the bundle it should write through |
| `app/src/test/emulator.ts` | `clearFirestoreData` flushes both instances |

**New — kid side:**

| File | Responsibility |
|---|---|
| `app/src/kid/KidSessionContext.tsx` | Kid claims → `{ familyId, kidId, kid, family, ageMode, status }` |
| `app/src/kid/ageMode.ts` | Birth year + override → `'5-8' | '8-12' | '12-16'` |
| `app/src/styles/ageModes.css` | Token overrides per `[data-age-mode]` — the whole visual difference between modes |
| `app/src/screens/kid/JoinKid.tsx` | Redeem an 8-character join code, sign in on the kid instance |
| `app/src/screens/kid/KidHome.tsx` | Celebratory balances plus "ways to earn" |
| `app/src/screens/kid/NewInvoice.tsx` | Draft-first invoice builder; photo-first at 5–8, prompted text at 8–12, dense at 12–16 |
| `app/src/screens/kid/InvoicePhotos.tsx` | Capture, compress, upload, remove |
| `app/src/screens/kid/KidInvoices.tsx` | History with statuses, the pay-stub breakdown, and 12–16 earnings stats |
| `app/src/screens/kid/InvoiceNegotiation.tsx` | Accept a counter-offer, or revise and resend |
| `app/src/lib/photos.ts` | `compressImage(file, maxEdge)` on a canvas |
| `app/src/lib/kidInvoice.ts` | `createDraft`, `updateDraft`, `sendInvoice`, `deleteDraft` |
| `app/src/components/Celebrate.tsx` | The approval celebration |
| `app/src/components/ProfileSwitcher.tsx` | Hand the device to a kid, or back to a parent behind the PIN |

**Also touched:** `firestore.indexes.json` (kid history index), `app/vite.config.ts` (PWA plugin), `app/public/` (icons), `e2e/` (Playwright), root `package.json` (`test:e2e`).

---

### Task 1: Two Firebase instances behind a context

**Why this is first and why it is a refactor, not a new file:** a kid borrowing a parent's phone needs a kid token — the invoice rules reject a parent creating an invoice — and Firebase Auth stores exactly one signed-in user per app instance. Twenty-five modules currently import the `db`/`auth`/`fns`/`storage` singletons. The trick that keeps this cheap: **the parent bundle keeps the old export names**, so parent screens and all 52 existing app tests compile and pass untouched; only the two hooks and the two write helpers change, because those are what a kid session must be able to redirect.

**Files:**
- Modify: `app/src/firebase.ts`, `app/src/hooks/useDoc.ts`, `app/src/hooks/useCollection.ts`, `app/src/lib/callables.ts`, `app/src/lib/invoiceActions.ts`, `app/src/test/emulator.ts`, and the parent call sites of the two write helpers (`screens/InvoiceDetail.tsx`, `screens/Kids.tsx`, `screens/Payouts.tsx`, `screens/Settings.tsx`, `screens/DeductionSettings.tsx`, `screens/JoinParent.tsx`, `lib/catalog.ts`)
- Create: `app/src/firebase/FirebaseContext.tsx`, `app/src/firebase/firebase.test.tsx`

**Interfaces:**
- Produces:
  - `interface FirebaseBundle { app: FirebaseApp; auth: Auth; db: Firestore; fns: Functions; storage: FirebaseStorage; label: 'parent' | 'kid' }`
  - `parentFb: FirebaseBundle`, `kidFb: FirebaseBundle` from `firebase.ts`, plus the unchanged `auth`/`db`/`fns`/`storage` exports aliased to `parentFb`
  - `<FirebaseProvider value={bundle}>`, `useFirebase(): FirebaseBundle` (defaults to `parentFb`)
  - `callables(fb: FirebaseBundle)` returning the typed callables; `returnInvoice(fb, familyId, invoice, note)` / `counterInvoice(fb, familyId, invoice, amount, note)`

- [ ] **Step 1: Write the failing test**

`app/src/firebase/firebase.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
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
    batch.set(doc(parentFb.db, 'families/famT/members', uid), { role: 'parent', displayName: 'Leo' });
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
    await waitFor(() => expect(viaKid.result.current.error).toBeInstanceOf(Error));
  });

  it('signing out one instance leaves the other alone', async () => {
    await signOut(kidFb.auth);
    expect(parentFb.auth.currentUser).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:app`
Expected: FAIL — `parentFb`/`kidFb` and the context do not exist.

- [ ] **Step 3: Split `firebase.ts` into two bundles**

```ts
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

const config = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
};

export interface FirebaseBundle {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  fns: Functions;
  storage: FirebaseStorage;
  label: 'parent' | 'kid';
}

function bundle(label: 'parent' | 'kid'): FirebaseBundle {
  // named apps are what make two live sessions possible: Firebase Auth keys
  // its persisted user by app name, so the parent and the kid do not evict
  // each other
  const app = initializeApp(config, label);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const fns = getFunctions(app);
  const storage = getStorage(app);
  if (import.meta.env.VITE_USE_EMULATORS) {
    // ports mirror firebase.json; Firestore is on 8480, not the default 8080
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8480);
    connectFunctionsEmulator(fns, '127.0.0.1', 5001);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
  }
  return { app, auth, db, fns, storage, label };
}

export const parentFb = bundle('parent');

/**
 * The kid bundle is REPLACEABLE, not frozen.
 *
 * Firestore's persistent cache is keyed by (app name, project, database) and
 * knows nothing about users: signing out does not clear it, and a cached read
 * is served locally without any rules evaluation, because rules run on the
 * server. On a shared device that means Kid B could read documents Kid A's
 * session cached. So a kid identity change must destroy the cache and rebuild
 * the instance — which is impossible if the bundle is a const the whole app
 * imported. Task 11 implements the reset; this is the seam it needs.
 */
export const KID_APP_NAME = 'kid';

let currentKid = bundle(KID_APP_NAME);
export function kidBundle(): FirebaseBundle { return currentKid; }
export function replaceKidBundle(next: FirebaseBundle): void { currentKid = next; }

/**
 * Rebuilds the kid bundle under the SAME app name.
 *
 * The name must be stable, and a generation counter ('kid-1', 'kid-2', …)
 * would be a bug: Firebase Auth keys its persisted user by app name, and the
 * counter lives in module memory. After a reload the module re-initializes
 * 'kid', so a kid signed in on 'kid-2' is silently signed out, the 'kid'
 * cache (the FIRST kid's, if a clear ever failed) is the one that comes back,
 * and every reset leaks another IndexedDB database that nothing cleans up.
 *
 * Caller contract: the previous app must already be deleted. `initializeApp`
 * with a live same-name app returns that existing instance — which, after a
 * reset, is the terminated one — so delete first, then call this.
 */
export function newKidBundle(): FirebaseBundle { return bundle(KID_APP_NAME); }

// the original singleton names, bound to the parent bundle: every parent
// screen and test written in Plan 2 keeps working with no edit
export const { auth, db, fns, storage } = parentFb;
```

**`kidFb` in this plan's later tasks means `kidBundle()`.** Tests may keep a local `const kidFb = kidBundle()` at the top of a file *only* if that file never resets the kid session; the reset tests must call `kidBundle()` after each reset.

`app/src/firebase/FirebaseContext.tsx`:
```tsx
import { createContext, useContext, type ReactNode } from 'react';
import { parentFb, type FirebaseBundle } from '../firebase.js';

// defaulting to the parent bundle is what keeps Plan 2's screens working
// without a provider anywhere in their tree
const FirebaseCtx = createContext<FirebaseBundle>(parentFb);

export function FirebaseProvider(
  { value, children }: { value: FirebaseBundle; children: ReactNode },
) {
  return <FirebaseCtx.Provider value={value}>{children}</FirebaseCtx.Provider>;
}

export function useFirebase(): FirebaseBundle {
  return useContext(FirebaseCtx);
}
```

- [ ] **Step 4: Point the hooks at the context**

`useDoc.ts` — replace the singleton import with the context, and note the dependency:
```ts
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useFirebase } from '../firebase/FirebaseContext.js';

export function useDoc<T>(path: string | null): DocState<T> {
  const { db } = useFirebase();
  const [state, setState] = useState<DocState<T>>({
    data: null, loading: path !== null, error: null,
  });

  useEffect(() => {
    if (path === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState({ data: null, loading: true, error: null });
    const unsub = onSnapshot(
      doc(db, path),
      (snap) => setState({
        data: snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null,
        loading: false, error: null,
      }),
      (error) => setState({ data: null, loading: false, error }),
    );
    return unsub;
    // db belongs in the deps: switching instances must resubscribe
  }, [path, db]);

  return state;
}
```

`useCollection.ts` needs no `db` (the caller already built the `Query` against an instance), so it changes only if the query identity guard needs it — leave it as is, and let callers build queries from `useFirebase().db`.

- [ ] **Step 5: Make the write helpers take a bundle**

`lib/callables.ts` becomes a factory, memoized per bundle so `httpsCallable` is not rebuilt on every render. **Type the members as `HttpsCallable<Req, Res>`** rather than writing the signatures by hand and casting the object `as unknown as Callables`: the SDK's type already describes `(data) => Promise<{ data: Res }>`, and the cast would silently accept a wrong request shape at every call site.
```ts
import { httpsCallable } from 'firebase/functions';
import type { DeductionRule } from '@money-kids/shared';
import type { FirebaseBundle } from '../firebase.js';

export interface Callables {
  createJoinCode: (d: { familyId: string; kidId: string }) => Promise<{ data: { code: string } }>;
  revokeKidAccess: (d: { familyId: string; kidId: string }) => Promise<unknown>;
  approveInvoice: (d: { familyId: string; invoiceId: string })
    => Promise<{ data: { approvedAmount: number; netAmount: number } }>;
  acceptCounterOffer: (d: { familyId: string; invoiceId: string })
    => Promise<{ data: { approvedAmount: number; netAmount: number } }>;
  recordPayout: (d: {
    familyId: string; kidId: string; balance: 'spendable' | 'savings';
    amount: number; note: string; requestId: string;
  }) => Promise<unknown>;
  setDeductionRules: (d: { familyId: string; rules: DeductionRule[] }) => Promise<unknown>;
  createParentInvite: (d: { familyId: string }) => Promise<{ data: { code: string } }>;
  acceptParentInvite: (d: { code: string }) => Promise<{ data: { familyId: string } }>;
  mintKidToken: (d: { code: string }) => Promise<{ data: { token: string } }>;
}

const cache = new WeakMap<FirebaseBundle, Callables>();

/** Every money mutation goes through here, on the caller's own instance. */
export function callables(fb: FirebaseBundle): Callables {
  const hit = cache.get(fb);
  if (hit) return hit;
  const c = {
    createJoinCode: httpsCallable(fb.fns, 'createJoinCode'),
    revokeKidAccess: httpsCallable(fb.fns, 'revokeKidAccess'),
    approveInvoice: httpsCallable(fb.fns, 'approveInvoice'),
    acceptCounterOffer: httpsCallable(fb.fns, 'acceptCounterOffer'),
    recordPayout: httpsCallable(fb.fns, 'recordPayout'),
    setDeductionRules: httpsCallable(fb.fns, 'setDeductionRules'),
    createParentInvite: httpsCallable(fb.fns, 'createParentInvite'),
    acceptParentInvite: httpsCallable(fb.fns, 'acceptParentInvite'),
    mintKidToken: httpsCallable(fb.fns, 'mintKidToken'),
  } as unknown as Callables;
  cache.set(fb, c);
  return c;
}
```

`lib/invoiceActions.ts` — both functions gain a leading `fb` parameter and use `fb.db` / `fb.auth`; the batching and event shape are unchanged. Update the parent call sites to `const fb = useFirebase();` and pass it. Same for `lib/catalog.ts`'s `seedCatalog(fb, familyId, currency, uid)`.

**`invoiceActions.test.ts` changes too** — it calls both helpers directly, so every call gains a leading `parentFb`. That file is the one place the signature change is visible outside a component, and typecheck is what surfaces it (eight errors, one per call); the tests themselves would still have passed had the parameter been optional, which is a reason not to make it optional.

- [ ] **Step 6: Flush both instances in the test helper**

`test/emulator.ts`:
```ts
export async function clearFirestoreData(): Promise<void> {
  // both instances: an unacknowledged write on EITHER is replayed after the
  // wipe and turns up in the next test
  await Promise.all([waitForPendingWrites(parentFb.db), waitForPendingWrites(kidFb.db)]);
  const res = await fetch(
    `http://127.0.0.1:8480/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(`clearFirestoreData failed: ${res.status} ${await res.text()}`);
}
```

Also add `signInTestKid(fb, code)` here — Task 2 uses it, and it belongs with the other harness helpers:
```ts
import { signInWithCustomToken } from 'firebase/auth';
import { callables } from '../lib/callables.js';

/** Redeems a join code on the kid instance, exactly as the kid screen does. */
export async function signInTestKid(code: string): Promise<void> {
  const { data } = await callables(kidFb).mintKidToken({ code });
  await signInWithCustomToken(kidFb.auth, data.token);
}
```

- [ ] **Step 7: Run everything — this task's success criterion is "nothing regressed"**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: the three new tests PASS **and all 52 Plan 2 app tests still pass**. If a parent screen broke, the aliased exports were bypassed somewhere — fix the call site rather than widening the aliases.

- [ ] **Step 8: Commit**

```bash
git add app
git commit -m "refactor(app): two Firebase instances behind a context"
```

---

### Task 2: Kid session — redeem a join code

**Files:**
- Create: `app/src/kid/KidSessionContext.tsx`, `app/src/kid/KidSessionContext.test.tsx`, `app/src/kid/ageMode.ts`, `app/src/kid/ageMode.test.ts`, `app/src/screens/kid/JoinKid.tsx`, `app/src/screens/kid/JoinKid.test.tsx`
- Modify: `app/src/i18n/*.json`, `firestore.rules`, `packages/rules-tests/src/family.test.ts`, `app/src/screens/Kids.tsx`, `app/src/screens/Kids.test.tsx`

**Interfaces:**
- Consumes: `mintKidToken` (Plan 1), `kidFb`, `useDoc`.
- Produces:
  - `ageModeFor(birthYear: number, override?: AgeMode | null, today?: Date): AgeMode` where `type AgeMode = '5-8' | '8-12' | '12-16'`
  - `<KidSessionProvider>` and `useKidSession(): KidSession`, with
    `KidSession = { familyId: string | null; kidId: string | null; kid: Kid | null; family: Family | null; ageMode: AgeMode; status: 'loading' | 'signed-out' | 'ready' }`
  - `interface Kid { id: string; name: string; birthYear: number; ageModeOverride?: AgeMode | null; deductionsEnabled: boolean; spendableBalance: number; savingsBalance: number }`
  - `<JoinKid />` at `/kid/join`

- [ ] **Step 1: Write the failing age-mode tests**

`app/src/kid/ageMode.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ageModeFor } from './ageMode.js';

const today = new Date('2026-09-07T00:00:00Z');

describe('ageModeFor', () => {
  it('maps age bands from the birth year', () => {
    expect(ageModeFor(2020, null, today)).toBe('5-8');   // 6
    expect(ageModeFor(2016, null, today)).toBe('8-12');  // 10
    expect(ageModeFor(2011, null, today)).toBe('12-16'); // 15
  });
  it('puts the boundaries where the spec puts them', () => {
    // the bands in the spec overlap at 8 and 12; the older mode wins, because
    // a kid who has outgrown the simpler screens should not be pushed back
    expect(ageModeFor(2018, null, today)).toBe('8-12');  // exactly 8
    expect(ageModeFor(2014, null, today)).toBe('12-16'); // exactly 12
  });
  it('clamps ages outside the range instead of throwing', () => {
    expect(ageModeFor(2024, null, today)).toBe('5-8');   // 2
    expect(ageModeFor(2001, null, today)).toBe('12-16'); // 25
  });
  it('lets a per-kid override win', () => {
    expect(ageModeFor(2020, '12-16', today)).toBe('12-16');
    expect(ageModeFor(2011, '5-8', today)).toBe('5-8');
  });
  it('ignores an override that is not a real mode', () => {
    // it arrives from a Firestore document, so it is untrusted: returning it
    // verbatim would stamp a data-age-mode no CSS block matches
    expect(ageModeFor(2016, 'grown-up' as never, today)).toBe('8-12');
    expect(ageModeFor(2016, '' as never, today)).toBe('8-12');
  });
});
```

- [ ] **Step 2: Implement it**

`app/src/kid/ageMode.ts`:
```ts
export type AgeMode = '5-8' | '8-12' | '12-16';

export const AGE_MODES: AgeMode[] = ['5-8', '8-12', '12-16'];

/**
 * The spec's bands overlap at 8 and 12. The older mode wins there: pushing a
 * kid who has just turned 12 back into the 8-12 screens reads as a demotion,
 * and a parent can always override per kid.
 *
 * The override comes from a Firestore document, so it is untrusted input: an
 * unrecognised value must fall back to the birth-year band rather than be
 * returned verbatim, or it reaches `data-age-mode`, matches no token block,
 * and silently degrades to the 8-12 baseline with no way to notice.
 */
export function ageModeFor(
  birthYear: number,
  override?: AgeMode | null,
  today: Date = new Date(),
): AgeMode {
  if (override && AGE_MODES.includes(override)) return override;
  const age = today.getUTCFullYear() - birthYear;
  if (age >= 12) return '12-16';
  if (age >= 8) return '8-12';
  return '5-8';
}
```

- [ ] **Step 3: Write the failing session and join tests**

`app/src/kid/KidSessionContext.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { doc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../firebase.js';

// kidBundle() rather than a frozen import: Task 11 replaces the kid instance
// when the kid identity changes, so a module-level const would go stale
const kidFb = kidBundle();
import { callables } from '../lib/callables.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../test/emulator.js';
import { KidSessionProvider, useKidSession } from './KidSessionContext.js';

const familyId = 'famKS';

function Probe() {
  const s = useKidSession();
  return <div data-testid="probe">{s.status}:{s.kid?.name ?? '-'}:{s.ageMode}</div>;
}

async function makeFamilyWithKid(): Promise<string> {
  await signInTestParent('kidsession');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'Talero', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  await batch.commit();
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear: 2016, deductionsEnabled: false,
    spendableBalance: 4000, savingsBalance: 1000,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  return data.code;
}

beforeEach(async () => { await clearFirestoreData(); await signOut(kidFb.auth); });

describe('KidSessionProvider', () => {
  it('is signed-out with no kid token', async () => {
    render(<KidSessionProvider><Probe /></KidSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('signed-out'));
  });

  it('resolves family, kid, and age mode from the token claims', async () => {
    const code = await makeFamilyWithKid();
    await signInTestKid(code);
    render(<KidSessionProvider><Probe /></KidSessionProvider>);
    // claims are the only source of familyId/kidId — never the UI
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('ready:Mia:8-12'));
  });

  it('honours a per-kid age-mode override', async () => {
    const code = await makeFamilyWithKid();
    await seedDoc(`families/${familyId}/kids/k1`, {
      name: 'Mia', birthYear: 2016, ageModeOverride: '5-8', deductionsEnabled: false,
      spendableBalance: 4000, savingsBalance: 1000,
    });
    await signInTestKid(code);
    render(<KidSessionProvider><Probe /></KidSessionProvider>);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('ready:Mia:5-8'));
  });
});
```

`app/src/screens/kid/JoinKid.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { doc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../../firebase.js';

const kidFb = kidBundle();
import { callables } from '../../lib/callables.js';
import { initI18n } from '../../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent } from '../../test/emulator.js';
import { JoinKid } from './JoinKid.js';

const familyId = 'famJK';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidFb.auth); });

async function joinCode(): Promise<string> {
  await signInTestParent('joinkidparent');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  await batch.commit();
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear: 2016, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  return data.code;
}

describe('JoinKid', () => {
  it('signs the kid in on the kid instance, leaving the parent session alone', async () => {
    const code = await joinCode();
    const parentUid = parentFb.auth.currentUser!.uid;
    render(<JoinKid />);
    await userEvent.type(screen.getByLabelText(/código/i), code.toLowerCase());
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    await waitFor(() => expect(kidFb.auth.currentUser).not.toBeNull(), { timeout: 5000 });
    // the uid is family-namespaced, and the claims carry the identity
    expect(kidFb.auth.currentUser!.uid).toBe(`kid_${familyId}_k1`);
    const claims = (await kidFb.auth.currentUser!.getIdTokenResult()).claims;
    expect(claims.role).toBe('kid');
    expect(claims.familyId).toBe(familyId);
    expect(claims.kidId).toBe('k1');
    // and the parent is still signed in on the other instance
    expect(parentFb.auth.currentUser!.uid).toBe(parentUid);
  });

  it('shows one error for a wrong, used, or malformed code', async () => {
    render(<JoinKid />);
    for (const bad of ['ABCD2345', 'nope', '']) {
      await userEvent.clear(screen.getByLabelText(/código/i));
      if (bad) await userEvent.type(screen.getByLabelText(/código/i), bad);
      await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    }
    expect(kidFb.auth.currentUser).toBeNull();
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npm run test:app`
Expected: FAIL — the kid session module and screen do not exist.

- [ ] **Step 5: Implement**

Add to `es.json` (mirror in `en.json`):
```json
  "kidJoin": {
    "title": "Entrar con tu código",
    "help": "Pídele el código a tu mamá o papá.",
    "code": "Código",
    "submit": "Entrar",
    "failed": "Ese código no sirve. Pide uno nuevo.",
    "reopen": "Cierra la app y ábrela otra vez para entrar con otro código."
  }
```
(`en`: `"title": "Sign in with your code", "help": "Ask a grown-up for the code.", "code": "Code", "submit": "Go", "failed": "That code does not work. Ask for a new one.", "reopen": "Close the app and open it again to sign in with a different code."`)

`app/src/kid/KidSessionContext.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { kidBundle } from '../firebase.js';

const kidFb = kidBundle();
import { FirebaseProvider } from '../firebase/FirebaseContext.js';
import { useDoc } from '../hooks/useDoc.js';
import { ageModeFor, type AgeMode } from './ageMode.js';
import type { Family } from '../session/SessionContext.js';

export interface Kid {
  id: string;
  name: string;
  birthYear: number;
  ageModeOverride?: AgeMode | null;
  deductionsEnabled: boolean;
  spendableBalance: number;
  savingsBalance: number;
}

export interface KidSession {
  familyId: string | null;
  kidId: string | null;
  kid: Kid | null;
  family: Family | null;
  ageMode: AgeMode;
  status: 'loading' | 'signed-out' | 'ready';
}

const KidCtx = createContext<KidSession | null>(null);

function Inner({ familyId, kidId, resolved, children }: {
  familyId: string | null; kidId: string | null; resolved: boolean; children: ReactNode;
}) {
  const kid = useDoc<Kid>(familyId && kidId ? `families/${familyId}/kids/${kidId}` : null);
  const family = useDoc<Family>(familyId ? `families/${familyId}` : null);

  let status: KidSession['status'] = 'loading';
  if (!resolved) status = 'loading';
  else if (!familyId || !kidId) status = 'signed-out';
  else if (kid.loading || family.loading) status = 'loading';
  else if (kid.data && family.data) status = 'ready';
  else status = 'loading';

  const ageMode = kid.data
    ? ageModeFor(kid.data.birthYear, kid.data.ageModeOverride ?? null)
    : '8-12';

  return (
    <KidCtx.Provider
      value={{ familyId, kidId, kid: kid.data, family: family.data, ageMode, status }}
    >
      {children}
    </KidCtx.Provider>
  );
}

export function KidSessionProvider({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState<{ familyId: string; kidId: string } | null>(null);
  const [resolved, setResolved] = useState(false);

  // read the bundle on every render: Task 11 swaps it on identity change
  const kidFb = kidBundle();

  useEffect(() => onIdTokenChanged(kidFb.auth, async (user) => {
    if (!user) {
      setClaims(null);
      setResolved(true);
      return;
    }
    // identity comes from the token, never from the UI
    const token = await user.getIdTokenResult();
    const familyId = token.claims.familyId;
    const kidId = token.claims.kidId;
    setClaims(
      typeof familyId === 'string' && typeof kidId === 'string' ? { familyId, kidId } : null,
    );
    setResolved(true);
  }), [kidFb.auth]);

  // every read below must go through the KID instance
  return (
    <FirebaseProvider value={kidFb}>
      <Inner
        familyId={claims?.familyId ?? null}
        kidId={claims?.kidId ?? null}
        resolved={resolved}
      >
        {children}
      </Inner>
    </FirebaseProvider>
  );
}

export function useKidSession(): KidSession {
  const s = useContext(KidCtx);
  if (!s) throw new Error('useKidSession must be used inside a KidSessionProvider');
  return s;
}
```

`app/src/screens/kid/JoinKid.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { signInWithCustomToken } from 'firebase/auth';
import { kidBundle } from '../../firebase.js';

const kidFb = kidBundle();
import { callables } from '../../lib/callables.js';
import { Button } from '../../components/Button.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import styles from '../SignIn.module.css';

export function JoinKid() {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setFailed(false);
    try {
      // uppercase here so a kid typing lowercase still works; the callable
      // validates the exact alphabet and rejects anything else
      const fb = kidBundle();
      const { data } = await callables(fb).mintKidToken({ code: code.trim().toUpperCase() });
      await signInWithCustomToken(fb.auth, data.token);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.screen}>
      <h1>{t('kidJoin.title')}</h1>
      <p>{t('kidJoin.help')}</p>
      {failed && <ErrorBanner message={t('kidJoin.failed')} />}
      <label htmlFor="kid-code">{t('kidJoin.code')}</label>
      <input
        id="kid-code" value={code} autoCapitalize="characters" autoComplete="off"
        onChange={(e) => setCode(e.target.value)}
      />
      <Button disabled={busy} onClick={join}>{t('kidJoin.submit')}</Button>
    </main>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS. If the kid's reads are denied, check the claims actually arrived: a custom token's claims appear only after `getIdTokenResult()`, and a stale token from a previous test can linger — hence the `signOut(kidFb.auth)` in `beforeEach`.

- [ ] **Step 7: Make the override actually settable — and validated**

Reading an override nothing can write is dead code. Two gaps to close.

**The rules accept anything today.** `kids` `allow update` blocks only the two balance keys, so a parent could write `ageModeOverride: 'banana'`. Add the failing test to `packages/rules-tests/src/family.test.ts`, inside `describe('kids docs', ...)`:
```ts
  it('accepts a real age-mode override, and only a real one', async () => {
    const pdb = parentCtx(env, 'p1').firestore();
    await assertSucceeds(updateDoc(doc(pdb, 'families/fam1/kids/k1'), { ageModeOverride: '5-8' }));
    await assertSucceeds(updateDoc(doc(pdb, 'families/fam1/kids/k1'), { ageModeOverride: null }));
    await assertFails(updateDoc(doc(pdb, 'families/fam1/kids/k1'), { ageModeOverride: 'banana' }));
    await assertFails(updateDoc(doc(pdb, 'families/fam1/kids/k1'), { ageModeOverride: 3 }));
    // a kid cannot choose their own mode
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertFails(updateDoc(doc(kdb, 'families/fam1/kids/k1'), { ageModeOverride: '12-16' }));
  });
```
Run `npm run test:rules` → FAIL, then add the check to the `kids` match block:
```
        function ageModeOverrideOk() {
          // optional, and either null (follow the birth year) or a real mode
          return !request.resource.data.keys().hasAny(['ageModeOverride'])
            || request.resource.data.ageModeOverride == null
            || request.resource.data.ageModeOverride in ['5-8', '8-12', '12-16'];
        }
```
chained onto both `create` and `update`. Run again → PASS.

**Then give the parent the control.** In `app/src/screens/Kids.tsx`, add a select to each kid card, and to the i18n files:
```json
  "kids": { "ageMode": "Modo por edad", "ageModeAuto": "Según la edad" }
```
(`en`: `"ageMode": "Age mode", "ageModeAuto": "By age"`)
```tsx
          <label htmlFor={`mode-${kid.id}`}>{t('kids.ageMode')}</label>
          <select
            id={`mode-${kid.id}`}
            value={kid.ageModeOverride ?? ''}
            onChange={(e) => updateDoc(doc(db, `families/${familyId}/kids/${kid.id}`), {
              // '' means "follow the birth year", stored as null so the field
              // is present and explicit rather than absent and ambiguous
              ageModeOverride: e.target.value === '' ? null : e.target.value,
            })}
          >
            <option value="">{t('kids.ageModeAuto')}</option>
            <option value="5-8">5–8</option>
            <option value="8-12">8–12</option>
            <option value="12-16">12–16</option>
          </select>
```
with `ageModeOverride?: '5-8' | '8-12' | '12-16' | null` added to that screen's `Kid` interface, and a test in `Kids.test.tsx`:
```tsx
  it('sets and clears the age-mode override', async () => {
    await seedDoc(`families/${familyId}/kids/k1`, {
      name: 'Mia', birthYear: 2016, deductionsEnabled: false,
      spendableBalance: 0, savingsBalance: 0,
    });
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    await userEvent.selectOptions(within(card).getByLabelText(/modo por edad/i), '5-8');
    await waitFor(async () => {
      const kids = await getDocsFromServer(collection(db, `families/${familyId}/kids`));
      expect(kids.docs[0]!.get('ageModeOverride')).toBe('5-8');
    }, { timeout: 5000 });
    await userEvent.selectOptions(within(card).getByLabelText(/modo por edad/i), '');
    await waitFor(async () => {
      const kids = await getDocsFromServer(collection(db, `families/${familyId}/kids`));
      expect(kids.docs[0]!.get('ageModeOverride')).toBeNull();
    }, { timeout: 5000 });
  });
```

- [ ] **Step 8: Verify and commit**

Run: `npm run test:app && npm run test:rules && npm run typecheck`
Expected: all PASS.

```bash
git add app firestore.rules packages/rules-tests
git commit -m "feat(app): kid session from a join code, with a settable age-mode override"
```

---

### Task 3: Kid shell, routes, and the age-mode token overrides

**This is where the three age modes actually live.** One set of components; the visual difference between a six-year-old's screen and a fifteen-year-old's is a block of CSS custom properties.

**Files:**
- Create: `app/src/styles/ageModes.css`, `app/src/kid/KidShell.tsx`, `app/src/kid/KidShell.test.tsx`, `app/src/kid/kidRoutes.tsx`
- Modify: `app/src/App.tsx`, `app/src/styles/global.css`, `app/src/i18n/*.json`

**Interfaces:**
- Consumes: `useKidSession`, `AgeMode`.
- Produces:
  - `<KidShell />` — mounts `data-age-mode` on the document root, renders the kid tabs and routes, and shows `<JoinKid />` when signed out
  - `KID_TABS` and `kidRoutes`, extended by Tasks 4, 5, 8, and 9
  - The kid app lives under `/kid/*`; `/kid/join` is reachable while signed out

- [ ] **Step 1: Write the failing test**

`app/src/kid/KidShell.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { doc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../firebase.js';

// kidBundle() rather than a frozen import: Task 11 replaces the kid instance
// when the kid identity changes, so a module-level const would go stale
const kidFb = kidBundle();
import { callables } from '../lib/callables.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../test/emulator.js';
import { KidSessionProvider } from './KidSessionContext.js';
import { KidShell } from './KidShell.js';

const familyId = 'famShell';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidFb.auth); });

async function seedKid(birthYear: number): Promise<string> {
  await signInTestParent('shellparent');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  await batch.commit();
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  return data.code;
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/kid']}>
      <KidSessionProvider><KidShell /></KidSessionProvider>
    </MemoryRouter>,
  );
}

describe('KidShell', () => {
  it('asks for a code when no kid is signed in', async () => {
    renderShell();
    await waitFor(() => expect(screen.getByLabelText(/código/i)).toBeInTheDocument());
  });

  it('stamps the age mode on the document root so tokens can key off it', async () => {
    await signInTestKid(await seedKid(2020)); // age 6
    renderShell();
    await waitFor(() => expect(document.documentElement.dataset.ageMode).toBe('5-8'));
  });

  it('uses the older band for a teenager', async () => {
    await signInTestKid(await seedKid(2011)); // age 15
    renderShell();
    await waitFor(() => expect(document.documentElement.dataset.ageMode).toBe('12-16'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:app`
Expected: FAIL — `KidShell.js` does not exist.

- [ ] **Step 3: Write the age-mode tokens**

`app/src/styles/ageModes.css` — these three blocks are the entire visual difference between the modes:
```css
/*
 * Age modes are token overrides, not separate screens. Everything here
 * re-declares variables already defined in tokens.css, so a component that
 * only uses tokens adapts to every mode with no conditional code.
 */

/* 5-8: few words, very large targets, money as big friendly numbers */
:root[data-age-mode='5-8'] {
  --f-body: 1.25rem;
  --f-small: 1rem;
  --f-title: 1.75rem;
  --f-money: 2.75rem;
  --tap: 3.5rem;
  --s-3: 1rem;
  --s-4: 1.25rem;
  --radius: 1.25rem;
}

/* 8-12 is the baseline: tokens.css already holds those values */

/* 12-16: denser, more on screen, less shouting */
:root[data-age-mode='12-16'] {
  --f-body: 0.9375rem;
  --f-small: 0.8125rem;
  --f-title: 1.1875rem;
  --f-money: 1.375rem;
  --tap: 2.5rem;
  --s-4: 0.75rem;
  --radius: 0.5rem;
}
```

Import it from `global.css`, after `tokens.css`:
```css
@import './tokens.css';
@import './ageModes.css';
```

- [ ] **Step 4: Implement the shell**

Add to `es.json` (mirror in `en.json`):
```json
  "kidNav": { "home": "Inicio", "new": "Nueva factura", "invoices": "Mis facturas" }
```
(`en`: `"home": "Home", "new": "New invoice", "invoices": "My invoices"`)

`app/src/kid/kidRoutes.tsx` — Tasks 4, 5, 8 and 9 append here:
```tsx
import type { ReactElement } from 'react';

export interface RouteDef { path: string; element: ReactElement }

export const KID_TABS: { to: string; labelKey: string }[] = [];

export const kidRoutes: RouteDef[] = [];
```

`app/src/kid/KidShell.tsx`:
```tsx
import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useKidSession } from './KidSessionContext.js';
import { JoinKid } from '../screens/kid/JoinKid.js';
import { BottomTabs } from '../components/BottomTabs.js';
import { Spinner } from '../components/Spinner.js';
import { KID_TABS, kidRoutes } from './kidRoutes.js';

export function KidShell() {
  const { status, ageMode } = useKidSession();

  useEffect(() => {
    // on the ROOT element, so every token override applies to portals and
    // fixed-position chrome too, not just the subtree
    document.documentElement.dataset.ageMode = ageMode;
    return () => { delete document.documentElement.dataset.ageMode; };
  }, [ageMode]);

  if (status === 'loading') return <main><Spinner /></main>;
  if (status === 'signed-out') return <JoinKid />;

  return (
    <>
      <main>
        <Routes>
          {kidRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
          {KID_TABS.length > 0 && (
            <Route path="*" element={<Navigate to={KID_TABS[0]!.to} replace />} />
          )}
        </Routes>
      </main>
      {KID_TABS.length > 0 && <BottomTabs tabs={KID_TABS.map((tab) => ({ ...tab }))} />}
    </>
  );
}
```

Mount it in `App.tsx` **above** the parent shell, and keep it outside the parent session gate — a kid device has no parent session at all:
```tsx
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* the kid app has its own session and its own Firebase instance */}
        <Route
          path="/kid/*"
          element={<KidSessionProvider><KidShell /></KidSessionProvider>}
        />
        <Route
          path="*"
          element={<SessionProvider><Shell /></SessionProvider>}
        />
      </Routes>
    </BrowserRouter>
  );
}
```
(`Shell` and `ParentShell` are unchanged; the `SessionProvider` simply moves inside the catch-all route.)

- [ ] **Step 5: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS, including every Plan 2 parent test — the parent routes still resolve because `path="*"` catches them.

- [ ] **Step 6: Commit**

```bash
git add app
git commit -m "feat(app): kid shell with age modes as token overrides"
```

---

### Task 4: Kid home — balances and ways to earn

**Files:**
- Create: `app/src/screens/kid/KidHome.tsx`, `app/src/screens/kid/KidHome.module.css`, `app/src/screens/kid/KidHome.test.tsx`
- Modify: `app/src/kid/kidRoutes.tsx`, `app/src/i18n/*.json`, `app/src/components/Money.tsx`, `app/src/session/SessionContext.tsx` (export `SessionCtx`), `app/src/kid/KidSessionContext.tsx` (export `KidCtx`)
- Create: `app/src/components/useCurrency.ts`

**Interfaces:**
- Consumes: `useKidSession`, `useCollection`, `<Money>`, `PillarIcon`.
- Produces: `<KidHome />` at `/kid` — the celebratory balance display (spendable, plus savings only when the kid has deductions on) and the active activity board.

**One change to a shared component:** `<Money>` reads the family from `useSession()`, which is the *parent* session and is null on a kid device. It must fall back to the kid session. Do this by having `Money` accept an explicit `currency`, and add a tiny `useCurrency()` hook that prefers whichever session is present — the alternative, two Money components, would drift.

- [ ] **Step 1: Write the failing test**

`app/src/screens/kid/KidHome.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../../firebase.js';

const kidFb = kidBundle();
import { callables } from '../../lib/callables.js';
import { initI18n } from '../../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../../test/emulator.js';
import { KidSessionProvider } from '../../kid/KidSessionContext.js';
import { KidHome } from './KidHome.js';

const familyId = 'famHome';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidFb.auth); });

async function seedAll(deductionsEnabled: boolean): Promise<string> {
  await signInTestParent('homeparent');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  batch.set(doc(parentFb.db, `families/${familyId}/activities/act1`), {
    titleEs: 'Lee un libro', titleEn: 'Read a book', descriptionEs: 'Cuéntamelo',
    descriptionEn: 'Tell me about it', suggestedPrice: 5000, category: 'learn',
    repeatable: true, active: true, createdBy: uid, createdAt: serverTimestamp(),
  });
  batch.set(doc(parentFb.db, `families/${familyId}/activities/act2`), {
    titleEs: 'Actividad guardada', titleEn: 'Archived activity', descriptionEs: '',
    descriptionEn: '', suggestedPrice: 1000, category: 'help',
    repeatable: true, active: false, createdBy: uid, createdAt: serverTimestamp(),
  });
  await batch.commit();
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear: 2016, deductionsEnabled,
    spendableBalance: 7000, savingsBalance: 2000,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  return data.code;
}

function renderHome() {
  return render(
    <MemoryRouter>
      <KidSessionProvider><KidHome /></KidSessionProvider>
    </MemoryRouter>,
  );
}

describe('KidHome', () => {
  it('shows the spendable balance and, with deductions on, the savings one', async () => {
    await signInTestKid(await seedAll(true));
    renderHome();
    await waitFor(() => expect(screen.getByTestId('spendable')).toHaveTextContent(/7[.,]?000/));
    expect(screen.getByTestId('savings')).toHaveTextContent(/2[.,]?000/);
  });

  it('hides the savings balance when the kid has deductions off', async () => {
    await signInTestKid(await seedAll(false));
    renderHome();
    await waitFor(() => expect(screen.getByTestId('spendable')).toBeInTheDocument());
    // nothing is being withheld, so a second balance would only confuse
    expect(screen.queryByTestId('savings')).toBeNull();
  });

  it('hides a one-time activity the kid has already had approved', async () => {
    // the spec asks for this as a courtesy: the approval function is what
    // actually prevents double payment, but offering an activity that can
    // only be refused is a bad screen
    const code = await seedAll(true);
    await seedDoc(`families/${familyId}/activities/once1`, {
      titleEs: 'Solo una vez', titleEn: 'One time only', descriptionEs: '', descriptionEn: '',
      suggestedPrice: 2000, category: 'ideas', repeatable: false, active: true,
      createdBy: 'p1', createdAt: new Date(),
    });
    await seedDoc(`families/${familyId}/invoices/done1`, {
      kidId: 'k1', activityId: 'once1', description: 'ya', photoPaths: [],
      status: 'approved', requestedAmount: 2000, approvedAmount: 2000, netAmount: 2000,
      deductions: [], eventCount: 2, createdAt: new Date(),
    });
    await signInTestKid(code);
    renderHome();
    expect(await screen.findByRole('heading', { name: /Lee un libro/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Solo una vez/ })).toBeNull();
  });

  it('keeps showing a repeatable activity the kid has already been paid for', async () => {
    const code = await seedAll(true);
    await seedDoc(`families/${familyId}/invoices/done2`, {
      kidId: 'k1', activityId: 'act1', description: 'ya', photoPaths: [],
      status: 'approved', requestedAmount: 5000, approvedAmount: 5000, netAmount: 5000,
      deductions: [], eventCount: 2, createdAt: new Date(),
    });
    await signInTestKid(code);
    renderHome();
    expect(await screen.findByRole('heading', { name: /Lee un libro/ })).toBeInTheDocument();
  });

  it('lists only active activities, with their suggested price', async () => {
    await signInTestKid(await seedAll(true));
    renderHome();
    expect(await screen.findByRole('heading', { name: /Lee un libro/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Actividad guardada/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Lee un libro/ }).getAttribute('href'))
      .toContain('/kid/new?activity=act1');
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npm run test:app` → FAIL (no `KidHome.js`).

Add to `es.json` (mirror in `en.json`):
```json
  "kidHome": {
    "greeting": "Hola, {{name}}",
    "spendable": "Tienes para gastar",
    "savings": "Y en tu ahorro",
    "waysToEarn": "Formas de ganar",
    "freeForm": "Tengo otra idea",
    "empty": "Todavía no hay actividades. Pídele a tu mamá o papá que agreguen algunas."
  }
```
(`en`: `"greeting": "Hi, {{name}}", "spendable": "You can spend", "savings": "And in your savings", "waysToEarn": "Ways to earn", "freeForm": "I have another idea", "empty": "No activities yet. Ask a grown-up to add some."`)

`<Money>` renders in both apps, and each has its own session. Reading them needs the **contexts**, not the `useSession`/`useKidSession` wrappers: those throw outside their provider, and catching a hook's throw is a trap — it only works while the wrapper contains nothing but `useContext`, and it breaks silently the day someone adds a `useMemo` to it.

So export both contexts. In `session/SessionContext.tsx` add `export const SessionCtx = createContext<Session | null>(null);` (it already exists — just export it), and do the same for `KidCtx` in `kid/KidSessionContext.tsx`. Then:

`app/src/components/useCurrency.ts`:
```ts
import { useContext } from 'react';
import { SessionCtx } from '../session/SessionContext.js';
import { KidCtx } from '../kid/KidSessionContext.js';

/**
 * Money renders in both apps. Reading the contexts directly means both hooks
 * run unconditionally and a missing provider is a null, not a throw — no
 * try/catch around hooks, which would be a Rules-of-Hooks accident waiting
 * to happen.
 */
export function useCurrencyAndLocale(): { currency: string | null; locale: string } {
  const parent = useContext(SessionCtx);
  const kid = useContext(KidCtx);
  const family = parent?.family ?? kid?.family ?? null;
  return {
    currency: family?.currency ?? null,
    locale: (family?.language ?? 'es') === 'es' ? 'es-CO' : 'en-US',
  };
}
```

Rewrite `Money` to use it:
```tsx
import { formatMinor } from '@money-kids/shared';
import { useCurrencyAndLocale } from './useCurrency.js';

export function Money({ amount, currency }: { amount: number; currency?: string }) {
  const resolved = useCurrencyAndLocale();
  const code = currency ?? resolved.currency;
  // never guess: a wrong currency on screen is worse than none
  if (!code) return null;
  return <span>{formatMinor(amount, code, resolved.locale)}</span>;
}
```

`app/src/screens/kid/KidHome.tsx`:
```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { collection, query, where } from 'firebase/firestore';
import { useFirebase } from '../../firebase/FirebaseContext.js';
import { useCollection } from '../../hooks/useCollection.js';
import { useKidSession } from '../../kid/KidSessionContext.js';
import { Card } from '../../components/Card.js';
import { Money } from '../../components/Money.js';
import { PillarIcon } from '../../components/PillarIcon.js';
import { Spinner } from '../../components/Spinner.js';
import type { Pillar } from '../../lib/catalog.js';
import styles from './KidHome.module.css';

interface Activity {
  id: string;
  titleEs: string; titleEn: string;
  descriptionEs: string; descriptionEn: string;
  suggestedPrice: number; category: Pillar;
  repeatable: boolean; active: boolean;
}

export function KidHome() {
  const { t, i18n } = useTranslation();
  const { db } = useFirebase();
  const { familyId, kidId, kid, status } = useKidSession();
  const isEs = i18n.language === 'es';
  const activities = useCollection<Activity>(
    familyId
      ? query(collection(db, `families/${familyId}/activities`), where('active', '==', true))
      : null,
  );

  // the kid's own invoices, to hide one-time activities they have already had
  // approved. Reusing the kidId-constrained query needs no extra index, and a
  // kid's invoice list is small; a second (kidId, status) index would buy
  // nothing here. The approval function is still the real guard — this is the
  // courtesy the spec asks for, not an invariant.
  const mine = useCollection<{ activityId: string | null; status: string }>(
    familyId && kidId
      ? query(collection(db, `families/${familyId}/invoices`), where('kidId', '==', kidId))
      : null,
  );
  const usedOneTime = new Set(
    mine.docs.filter((i) => i.status === 'approved' && i.activityId).map((i) => i.activityId!),
  );

  if (status !== 'ready' || !kid) return <div className={styles.screen}><Spinner /></div>;

  const offered = activities.docs.filter(
    (activity) => activity.repeatable || !usedOneTime.has(activity.id),
  );

  return (
    <div className={styles.screen}>
      <h1>{t('kidHome.greeting', { name: kid.name })}</h1>

      <div className={styles.balances}>
        <p className={styles.label}>{t('kidHome.spendable')}</p>
        <p className={styles.big} data-testid="spendable">
          <Money amount={kid.spendableBalance} />
        </p>
        {kid.deductionsEnabled && (
          <>
            <p className={styles.label}>{t('kidHome.savings')}</p>
            <p className={styles.medium} data-testid="savings">
              <Money amount={kid.savingsBalance} />
            </p>
          </>
        )}
      </div>

      <h2>{t('kidHome.waysToEarn')}</h2>
      <Link to="/kid/new" className={styles.freeForm}>{t('kidHome.freeForm')}</Link>

      {activities.loading && <Spinner />}
      {!activities.loading && offered.length === 0 && <p>{t('kidHome.empty')}</p>}
      {offered.map((activity) => (
        <Link
          key={activity.id}
          to={`/kid/new?activity=${activity.id}`}
          aria-label={isEs ? activity.titleEs : activity.titleEn}
        >
          <Card label={isEs ? activity.titleEs : activity.titleEn}>
            <h3><PillarIcon pillar={activity.category} /> {isEs ? activity.titleEs : activity.titleEn}</h3>
            <p>{isEs ? activity.descriptionEs : activity.descriptionEn}</p>
            <p className={styles.medium}><Money amount={activity.suggestedPrice} /></p>
          </Card>
        </Link>
      ))}
    </div>
  );
}
```

`app/src/screens/kid/KidHome.module.css`:
```css
.screen { padding: var(--s-4) var(--s-4) calc(var(--tap) + var(--s-6)); }
.balances {
  text-align: center;
  padding: var(--s-5) var(--s-4);
  margin-bottom: var(--s-5);
  border-radius: var(--radius);
  background: var(--c-surface);
  box-shadow: var(--shadow);
}
.label { margin: 0; font-size: var(--f-small); color: var(--c-ink-soft); }
.big { margin: 0 0 var(--s-3); font-size: var(--f-money); font-weight: 800; color: var(--c-money); }
.medium { margin: 0; font-size: calc(var(--f-money) * 0.6); font-weight: 700; color: var(--c-money); }
.freeForm { display: inline-block; margin-bottom: var(--s-4); color: var(--c-accent); }
```

Register the route and tab in `kidRoutes.tsx`: `KID_TABS = [{ to: '/kid', labelKey: 'kidNav.home' }]` and `kidRoutes = [{ path: '/', element: <KidHome /> }]`.

**Note on nested routes:** `KidShell` renders inside `path="/kid/*"`, so its child paths are *relative* — `'/'` for home, `'new'` for the builder. The tab `to` values stay absolute (`/kid`, `/kid/new`) because `NavLink` needs a real URL.

- [ ] **Step 3: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS. If the activity query is denied, the kid is querying with a filter the rules do not allow — `activities` permits an unconstrained read, so a denial means the read went through the parent instance instead of the kid one.

- [ ] **Step 4: Commit**

```bash
git add app
git commit -m "feat(app): kid home with balances and ways to earn"
```

---

### Task 5: Invoice drafts — create, edit, delete

**Files:**
- Create: `app/src/lib/kidInvoice.ts`, `app/src/lib/kidInvoice.test.ts`
- Modify: `firestore.indexes.json`, `firestore.rules`, `packages/rules-tests/src/invoices.test.ts`

**Interfaces:**
- Consumes: `FirebaseBundle`, the invoice rules from Plan 1.
- Produces:
  - `createDraft(fb, { familyId, kidId, activityId, description, requestedAmount, category? }): Promise<string>` — returns the new invoice id; writes the whitelisted keys with `status: 'draft'`, `eventCount: 0`, `createdAt: serverTimestamp()`, `photoPaths: []`, and `category` only when given
  - `updateDraft(fb, { familyId, invoiceId, status, fields })` — only the fields the current status permits
  - `deleteDraft(fb, familyId, invoiceId)`
  - `sendInvoice(...)` arrives in Task 7; keep this module the single place kid invoice writes live

- [ ] **Step 1: Let a free-form invoice carry its category**

The spec's free-form path is "kid picks category, writes description, sets their own price" — but the invoice document has **no category field**, and the create whitelist rejects a ninth key, so as shipped that choice has nowhere to live. An invoice raised against an activity inherits its category through `activityId`; a free-form one has no activity, so it needs its own.

Add `category` as an **optional** key, constrained to the four pillars. Optional matters: every invoice Plans 1–2 wrote has no category, and making it required would reject edits to them.

First the failing rules tests — append inside `describe('invoice lifecycle', ...)` in `packages/rules-tests/src/invoices.test.ts`:
```ts
  it('accepts an optional pillar category on a free-form invoice', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertSucceeds(setDoc(doc(kdb, 'families/fam1/invoices/cat1'),
      { ...draft, category: 'courage' }));
    // still optional: an invoice with no category remains valid
    await assertSucceeds(setDoc(doc(kdb, 'families/fam1/invoices/cat2'), draft));
    // and only the four pillars are categories
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/cat3'),
      { ...draft, category: 'chores' }));
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/cat4'),
      { ...draft, category: 7 }));
  });

  it('lets a kid change the category while the invoice is still theirs to edit', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/cat5'), { ...draft, category: 'learn' });
    await assertSucceeds(updateDoc(doc(kdb, 'families/fam1/invoices/cat5'), { category: 'ideas' }));
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/cat5'), { category: 'chores' }));
  });
```

Run `npm run test:rules` → FAIL. Then amend the `invoices` rules: add `'category'` to the create `hasOnly` list (**not** to `hasAll` — it is optional), add it to the kid-edit and `→ sent` `affectedKeys().hasOnly` lists, and add one shared check used by create and every kid edit:
```
        function categoryOk() {
          // optional, but when present it is one of the spec's four pillars
          return !newInv().keys().hasAny(['category'])
            || newInv().category in ['learn', 'courage', 'ideas', 'help'];
        }
```
Chain `&& categoryOk()` onto the invoice `create` rule and onto both kid `update` rules. Run `npm run test:rules` → PASS, and confirm the Plan 1–2 invoice tests still pass, since nothing became required.

- [ ] **Step 2: Add the index the kid history needs**

Kid history is `where('kidId','==',own)` ordered by `createdAt` — a composite index. Append to `firestore.indexes.json`:
```json
    {
      "collectionGroup": "invoices",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "kidId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
```

- [ ] **Step 3: Write the failing tests**

`app/src/lib/kidInvoice.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { doc, getDocFromServer, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../firebase.js';

// kidBundle() rather than a frozen import: Task 11 replaces the kid instance
// when the kid identity changes, so a module-level const would go stale
const kidFb = kidBundle();
import { callables } from './callables.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../test/emulator.js';
import { createDraft, updateDraft, deleteDraft } from './kidInvoice.js';

const familyId = 'famDraft';

async function seedKidSession(): Promise<void> {
  await signInTestParent('draftparent');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  await batch.commit();
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear: 2016, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  await seedDoc(`families/${familyId}/kids/k2`, {
    name: 'Sib', birthYear: 2014, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  await signInTestKid(data.code);
}

beforeEach(async () => {
  await clearFirestoreData();
  await signOut(kidFb.auth);
  await seedKidSession();
});

describe('createDraft', () => {
  it('writes a draft the rules accept, with a server timestamp', async () => {
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null,
      description: 'Leí un libro', requestedAmount: 5000,
    });
    const snap = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    expect(snap.get('status')).toBe('draft');
    expect(snap.get('eventCount')).toBe(0);
    expect(snap.get('photoPaths')).toEqual([]);
    expect(snap.get('createdAt')).toBeTruthy();
    expect(Object.keys(snap.data()!).sort()).toEqual([
      'activityId', 'createdAt', 'description', 'eventCount',
      'kidId', 'photoPaths', 'requestedAmount', 'status',
    ]);
  });

  it('cannot create an invoice for a sibling', async () => {
    await expect(createDraft(kidFb, {
      familyId, kidId: 'k2', activityId: null, description: 'no', requestedAmount: 100,
    })).rejects.toThrow();
  });

  it('refuses a non-positive amount and an over-long description locally', async () => {
    await expect(createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null, description: 'x', requestedAmount: 0,
    })).rejects.toThrow(/amount/i);
    await expect(createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null, description: 'x'.repeat(1001), requestedAmount: 100,
    })).rejects.toThrow(/description/i);
  });
});

describe('updateDraft', () => {
  it('edits the fields a draft allows', async () => {
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null, description: 'antes', requestedAmount: 5000,
    });
    await updateDraft(kidFb, {
      familyId, invoiceId: id, status: 'draft',
      fields: { description: 'después', requestedAmount: 6000, activityId: 'act1' },
    });
    const snap = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    expect(snap.get('description')).toBe('después');
    expect(snap.get('requestedAmount')).toBe(6000);
    expect(snap.get('activityId')).toBe('act1');
  });

  it('does not send activityId once the invoice has left draft', async () => {
    // the rules allow activityId edits ONLY in draft; sending it from a
    // returned invoice would fail the whole write, losing the kid's edit
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: 'act1', description: 'x', requestedAmount: 100,
    });
    await seedDoc(`families/${familyId}/invoices/${id}`, {
      kidId: 'k1', activityId: 'act1', description: 'x', photoPaths: [],
      status: 'returned', requestedAmount: 100, eventCount: 2, createdAt: new Date(),
    });
    await updateDraft(kidFb, {
      familyId, invoiceId: id, status: 'returned',
      fields: { description: 'mejor', requestedAmount: 200, activityId: 'act9' },
    });
    const snap = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    expect(snap.get('description')).toBe('mejor');
    expect(snap.get('activityId')).toBe('act1'); // silently dropped, not rejected
  });

  it('cannot edit an approved invoice', async () => {
    const id = 'approved1';
    await seedDoc(`families/${familyId}/invoices/${id}`, {
      kidId: 'k1', activityId: null, description: 'x', photoPaths: [],
      status: 'approved', requestedAmount: 100, approvedAmount: 100, netAmount: 100,
      deductions: [], eventCount: 2, createdAt: new Date(),
    });
    await expect(updateDraft(kidFb, {
      familyId, invoiceId: id, status: 'approved', fields: { description: 'nope' },
    })).rejects.toThrow(/editable/i);
  });
});

describe('deleteDraft', () => {
  it('deletes a draft but not a sent invoice', async () => {
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null, description: 'x', requestedAmount: 100,
    });
    await deleteDraft(kidFb, familyId, id);
    expect((await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`))).exists())
      .toBe(false);

    await seedDoc(`families/${familyId}/invoices/sent1`, {
      kidId: 'k1', activityId: null, description: 'x', photoPaths: [],
      status: 'sent', requestedAmount: 100, eventCount: 1, createdAt: new Date(),
    });
    await expect(deleteDraft(kidFb, familyId, 'sent1')).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run to verify they fail, then implement**

Run: `npm run test:app` → FAIL (no `kidInvoice.js`).

`app/src/lib/kidInvoice.ts`:
```ts
import { collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import type { FirebaseBundle } from '../firebase.js';

const MAX_DESCRIPTION = 1000;
const KID_EDITABLE = ['draft', 'returned', 'countered'] as const;
type KidEditable = typeof KID_EDITABLE[number];

export type Pillar = 'learn' | 'courage' | 'ideas' | 'help';

export interface DraftInput {
  familyId: string;
  kidId: string;
  activityId: string | null;
  description: string;
  requestedAmount: number;
  /** free-form invoices carry their own pillar; activity-backed ones inherit it */
  category?: Pillar | null;
}

function assertAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('amount must be a positive integer in minor units');
  }
}

function assertDescription(description: string): void {
  if (description.length > MAX_DESCRIPTION) {
    throw new Error(`description must be at most ${MAX_DESCRIPTION} characters`);
  }
}

/**
 * A draft is a real document, written before any photo upload: the Storage
 * rules authorize an upload by reading the linked invoice, and a draft that
 * only lived in component state would vanish with the device.
 *
 * The eight keys here are exactly the rules' whitelist. Adding a ninth — even
 * a harmless one — makes every create fail.
 */
export async function createDraft(fb: FirebaseBundle, input: DraftInput): Promise<string> {
  assertAmount(input.requestedAmount);
  assertDescription(input.description);
  const ref = doc(collection(fb.db, `families/${input.familyId}/invoices`));
  await setDoc(ref, {
    kidId: input.kidId,
    activityId: input.activityId,
    description: input.description,
    photoPaths: [],
    status: 'draft',
    requestedAmount: input.requestedAmount,
    eventCount: 0,
    createdAt: serverTimestamp(),
    // omitted entirely when absent: `category: undefined` would be rejected,
    // and the field is optional in the rules
    ...(input.category ? { category: input.category } : {}),
  });
  return ref.id;
}

export async function updateDraft(fb: FirebaseBundle, args: {
  familyId: string;
  invoiceId: string;
  status: string;
  fields: { description?: string; requestedAmount?: number; activityId?: string | null };
}): Promise<void> {
  if (!KID_EDITABLE.includes(args.status as KidEditable)) {
    throw new Error(`status ${args.status} is not kid-editable`);
  }
  const patch: Record<string, unknown> = {};
  if (args.fields.description !== undefined) {
    assertDescription(args.fields.description);
    patch.description = args.fields.description;
  }
  if (args.fields.requestedAmount !== undefined) {
    assertAmount(args.fields.requestedAmount);
    patch.requestedAmount = args.fields.requestedAmount;
  }
  // activityId is editable ONLY in draft. Sending it later would fail the
  // whole update and lose the kid's text, so drop it instead.
  if (args.fields.activityId !== undefined && args.status === 'draft') {
    patch.activityId = args.fields.activityId;
  }
  if (Object.keys(patch).length === 0) return;
  await updateDoc(doc(fb.db, `families/${args.familyId}/invoices/${args.invoiceId}`), patch);
}

/** Only a draft is deletable, and only by its owner — the rules enforce both. */
export async function deleteDraft(
  fb: FirebaseBundle, familyId: string, invoiceId: string,
): Promise<void> {
  await deleteDoc(doc(fb.db, `families/${familyId}/invoices/${invoiceId}`));
}
```

- [ ] **Step 5: Verify**

Run: `npm run test:app && npm run test:rules && npm run typecheck`
Expected: all PASS, including every Plan 1–2 rules test.

- [ ] **Step 6: Commit**

```bash
git add app firestore.rules firestore.indexes.json packages/rules-tests
git commit -m "feat(app): kid invoice drafts, with an optional pillar category"
```

---

### Task 6: The invoice builder, including the 5–8 photo-first variant

**The one place age modes are behavioral, not cosmetic.** At 5–8 the spec calls for photo-first invoices "instead of typing": the kid takes a picture, taps a category emoji, and taps a price from a small set of choices. At 8–12 they get prompted text fields; at 12–16 the same fields, denser, with the price shown as a negotiating position.

**Files:**
- Create: `app/src/lib/photos.ts`, `app/src/lib/photos.test.ts`, `app/src/screens/kid/NewInvoice.tsx`, `app/src/screens/kid/NewInvoice.module.css`, `app/src/screens/kid/NewInvoice.test.tsx`, `app/src/screens/kid/InvoicePhotos.tsx`
- Modify: `app/src/kid/kidRoutes.tsx`, `app/src/i18n/*.json`

**Interfaces:**
- Consumes: `createDraft`/`updateDraft`, `parseMajor`, the Storage rules from Plan 1.
- Produces:
  - `compressImage(file: File, maxEdge?: number): Promise<Blob>` — canvas resize to ≤ 1200 px on the long edge, JPEG quality 0.8, and **never returns something larger than the 5 MB Storage limit**
  - `uploadInvoicePhoto(fb, { familyId, kidId, invoiceId, file }): Promise<string>` — compresses, uploads under a **random** file name, records the path, returns it
  - `removeInvoicePhoto(fb, { familyId, invoiceId, path }): Promise<void>` — detaches the path, then deletes the object
  - `<NewInvoice />` at `/kid/new` (accepts `?activity=<id>` to prefill from the board)
  - `<InvoicePhotos />` — thumbnails from `getDownloadURL`, add, remove, and the 8-photo cap surfaced in the UI

- [ ] **Step 1: Write the failing compression tests**

`app/src/lib/photos.test.ts` — jsdom has no real canvas encoder, so the test asserts the contract the caller depends on and stubs the parts jsdom cannot do:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compressImage, MAX_EDGE, MAX_UPLOAD_BYTES } from './photos.js';

/**
 * jsdom implements neither image decoding nor canvas encoding, so the test
 * injects both seams. What is being tested is our arithmetic and our limits,
 * which is exactly where a 100x-sized upload or a squashed photo would come
 * from — not the browser's codec.
 */
function stubImage(width: number, height: number) {
  class FakeImage {
    width = width;
    height = height;
    onload: (() => void) | null = null;
    set src(_v: string) { setTimeout(() => this.onload?.(), 0); }
  }
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => undefined,
  });
}

let drawn: { w: number; h: number } | null = null;

beforeEach(() => {
  drawn = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: (_img: unknown, _x: number, _y: number, w: number, h: number) => {
      drawn = { w, h };
    },
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    function (this: HTMLCanvasElement, cb: BlobCallback) {
      cb(new Blob([new Uint8Array(1024)], { type: 'image/jpeg' }));
    },
  );
});

describe('compressImage', () => {
  it('scales the long edge down to the cap and keeps the aspect ratio', async () => {
    stubImage(4000, 3000);
    const out = await compressImage(new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' }));
    expect(out.type).toBe('image/jpeg');
    expect(drawn).toEqual({ w: MAX_EDGE, h: Math.round(MAX_EDGE * 3000 / 4000) });
  });

  it('scales the other axis when the photo is portrait', async () => {
    stubImage(1500, 3000);
    await compressImage(new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' }));
    expect(drawn).toEqual({ w: Math.round(MAX_EDGE * 1500 / 3000), h: MAX_EDGE });
  });

  it('never upscales a small photo', async () => {
    stubImage(400, 300);
    await compressImage(new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' }));
    expect(drawn).toEqual({ w: 400, h: 300 });
  });

  it('rejects a non-image file before touching a canvas', async () => {
    stubImage(100, 100);
    await expect(
      compressImage(new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' })),
    ).rejects.toThrow(/image/i);
  });

  it('rejects a result over the storage limit rather than uploading a doomed blob', async () => {
    stubImage(1000, 1000);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: 'image/jpeg' }));
      },
    );
    await expect(
      compressImage(new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' })),
    ).rejects.toThrow(/too large/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement compression**

Run: `npm run test:app` → FAIL (no `photos.js`).

`app/src/lib/photos.ts`:
```ts
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { arrayRemove, arrayUnion, doc, updateDoc } from 'firebase/firestore';
import type { FirebaseBundle } from '../firebase.js';

export const MAX_EDGE = 1200;               // the spec's ~1200px
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // the Storage rule's cap
export const MAX_PHOTOS = 8;                // the Firestore rule's cap
const QUALITY = 0.8;

/**
 * Resizes on a canvas and re-encodes as JPEG. A phone photo is several
 * megabytes; the Storage rule rejects anything over 5 MB, and a kid on a
 * home connection should not be uploading that anyway.
 */
export async function compressImage(file: File, maxEdge = MAX_EDGE): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('only image files can be attached');

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('that image could not be read'));
      img.src = url;
    });

    const longEdge = Math.max(image.width, image.height);
    // never upscale: enlarging a small photo only wastes bytes
    const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('that image could not be processed');
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', QUALITY);
    });
    if (!blob) throw new Error('that image could not be processed');
    if (blob.size > MAX_UPLOAD_BYTES) {
      // fail here rather than let Storage reject the upload after the wait
      throw new Error('that photo is too large, even after shrinking');
    }
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Uploads one photo and records its path on the invoice.
 *
 * The Storage rule reads the linked invoice and requires it to exist, to be
 * in a kid-editable status, and to belong to the kid in the path — so this
 * only works on a draft that has already reached the server.
 */
export async function uploadInvoicePhoto(fb: FirebaseBundle, args: {
  familyId: string; kidId: string; invoiceId: string; file: File;
}): Promise<string> {
  const blob = await compressImage(args.file);
  // a RANDOM name, never the array length: after a removal the length repeats
  // an index that is still in use, and the next upload would silently
  // overwrite an existing photo
  const path = `families/${args.familyId}/kids/${args.kidId}/invoices/${args.invoiceId}`
    + `/${crypto.randomUUID()}.jpg`;
  await uploadBytes(ref(fb.storage, path), blob, { contentType: 'image/jpeg' });
  try {
    await updateDoc(doc(fb.db, `families/${args.familyId}/invoices/${args.invoiceId}`), {
      photoPaths: arrayUnion(path),
    });
  } catch (e) {
    // the object is up but unreferenced, and nothing else will ever find it.
    // Best-effort clean-up, then report the failure: an orphan the user
    // cannot see is worse than a retry they can.
    await deleteObject(ref(fb.storage, path)).catch(() => undefined);
    throw e;
  }
  return path;
}

/**
 * Detaches first, then deletes.
 *
 * That order matters: if the delete fails, the invoice no longer points at a
 * missing object, and the leftover file is invisible rather than broken. The
 * reverse order would leave a path on the invoice with nothing behind it, and
 * every reader — including the parent's review screen — would show a gap.
 */
export async function removeInvoicePhoto(fb: FirebaseBundle, args: {
  familyId: string; invoiceId: string; path: string;
}): Promise<void> {
  await updateDoc(doc(fb.db, `families/${args.familyId}/invoices/${args.invoiceId}`), {
    photoPaths: arrayRemove(args.path),
  });
  await deleteObject(ref(fb.storage, args.path)).catch(() => undefined);
}
```

- [ ] **Step 3: Write the failing builder tests**

`app/src/screens/kid/NewInvoice.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { collection, doc, getDocsFromServer, serverTimestamp, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../../firebase.js';

const kidFb = kidBundle();
import { callables } from '../../lib/callables.js';
import { initI18n } from '../../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../../test/emulator.js';
import { KidSessionProvider } from '../../kid/KidSessionContext.js';
import { NewInvoice } from './NewInvoice.js';

const familyId = 'famNew';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidFb.auth); });

async function seedKid(birthYear: number): Promise<string> {
  await signInTestParent('newparent');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  batch.set(doc(parentFb.db, `families/${familyId}/activities/act1`), {
    titleEs: 'Lee un libro', titleEn: 'Read a book', descriptionEs: '', descriptionEn: '',
    suggestedPrice: 5000, category: 'learn', repeatable: true, active: true,
    createdBy: uid, createdAt: serverTimestamp(),
  });
  await batch.commit();
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  return data.code;
}

function renderNew(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/kid/new${search}`]}>
      <KidSessionProvider><NewInvoice /></KidSessionProvider>
    </MemoryRouter>,
  );
}

async function invoices() {
  return getDocsFromServer(collection(kidFb.db, `families/${familyId}/invoices`));
}

describe('NewInvoice at 8-12', () => {
  it('creates a draft from a free-form idea with the kid’s own price', async () => {
    await signInTestKid(await seedKid(2016));
    renderNew();
    // free-form: the kid picks the pillar, writes the words, names the price
    await userEvent.click(await screen.findByRole('button', { name: /ayudar/i }));
    await userEvent.type(screen.getByLabelText(/qué hiciste/i), 'Ordené mi cuarto');
    await userEvent.type(screen.getByLabelText(/cuánto/i), '4000');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(async () => {
      const all = await invoices();
      expect(all.size).toBe(1);
      expect(all.docs[0]!.get('status')).toBe('draft');
      expect(all.docs[0]!.get('description')).toBe('Ordené mi cuarto');
      expect(all.docs[0]!.get('requestedAmount')).toBe(4000);
      expect(all.docs[0]!.get('activityId')).toBeNull();
      expect(all.docs[0]!.get('category')).toBe('help'); // the picked pillar
    }, { timeout: 5000 });
  });

  it('prefills price and activity when it came from the board', async () => {
    await signInTestKid(await seedKid(2016));
    renderNew('?activity=act1');
    // the suggested price is a starting point the kid can change
    await waitFor(() => expect(screen.getByLabelText(/cuánto/i)).toHaveValue('5000'));
    await userEvent.type(screen.getByLabelText(/qué hiciste/i), 'Leí El principito');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(async () => {
      const all = await invoices();
      expect(all.docs[0]!.get('activityId')).toBe('act1');
    }, { timeout: 5000 });
  });

  it('will not save without a description or with an unparseable price', async () => {
    await signInTestKid(await seedKid(2016));
    renderNew();
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/qué hiciste/i), 'algo');
    await userEvent.type(screen.getByLabelText(/cuánto/i), 'abc');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect((await invoices()).size).toBe(0);
  });
});

describe('NewInvoice at 5-8', () => {
  it('offers price choices and a category picker instead of typing', async () => {
    await signInTestKid(await seedKid(2020)); // age 6
    renderNew();
    // no free-text price field at this age
    await waitFor(() => expect(screen.queryByLabelText(/cuánto/i)).toBeNull());
    await userEvent.click(await screen.findByRole('button', { name: /valentía/i }));
    const choices = screen.getAllByTestId('price-choice');
    expect(choices.length).toBeGreaterThanOrEqual(3);
    await userEvent.click(choices[1]!);
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(async () => {
      const all = await invoices();
      expect(all.size).toBe(1);
      expect(all.docs[0]!.get('requestedAmount')).toBeGreaterThan(0);
      // the category becomes the description at this age, since the kid did
      // not type anything — the photo is the evidence
      expect(all.docs[0]!.get('description')).toMatch(/valentía/i);
    }, { timeout: 5000 });
  });
});
```

- [ ] **Step 4: Run to verify it fails, then implement**

Run: `npm run test:app` → FAIL (no `NewInvoice.js`).

Add to `es.json` (mirror in `en.json`):
```json
  "kidNew": {
    "title": "Nueva factura",
    "what": "¿Qué hiciste?",
    "whatHint": "Una frase está bien.",
    "howMuch": "¿Cuánto vale?",
    "pickCategory": "¿Qué tipo fue?",
    "pickPrice": "¿Cuánto vale?",
    "save": "Guardar",
    "send": "Enviar a mamá o papá",
    "needDescription": "Cuéntame qué hiciste.",
    "badAmount": "Escribe un precio válido.",
    "photos": "Fotos",
    "addPhoto": "Agregar foto",
    "removePhoto": "Quitar",
    "photoLimit": "Ya tienes 8 fotos.",
    "photoFailed": "Esa foto no se pudo subir. Intenta otra vez. Necesitas internet para subir fotos.",
    "needPhoto": "Agrega una foto de lo que hiciste para poder enviarla.",
    "saved": "Guardada. Ahora puedes agregar fotos o enviarla."
  }
```
(`en`: `"title": "New invoice", "what": "What did you do?", "whatHint": "One sentence is fine.", "howMuch": "How much is it worth?", "pickCategory": "What kind was it?", "pickPrice": "How much is it worth?", "save": "Save", "send": "Send to a grown-up", "needDescription": "Tell me what you did.", "badAmount": "Enter a valid price.", "photos": "Photos", "addPhoto": "Add photo", "removePhoto": "Remove", "photoLimit": "You already have 8 photos.", "photoFailed": "That photo could not be uploaded. Try again. You need a connection to upload photos.", "needPhoto": "Add a photo of what you did so you can send it.", "saved": "Saved. Now you can add photos or send it."`)

`app/src/screens/kid/NewInvoice.tsx` — one component, one behavioral branch:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { parseMajor, minorDigits } from '@money-kids/shared';
import { useFirebase } from '../../firebase/FirebaseContext.js';
import { useKidSession } from '../../kid/KidSessionContext.js';
import { createDraft } from '../../lib/kidInvoice.js';
import { Button } from '../../components/Button.js';
import { Card } from '../../components/Card.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { Money } from '../../components/Money.js';
import { PillarIcon } from '../../components/PillarIcon.js';
import { Spinner } from '../../components/Spinner.js';
import { InvoicePhotos } from './InvoicePhotos.js';
import type { Pillar } from '../../lib/catalog.js';
import styles from './NewInvoice.module.css';

const PILLARS: Pillar[] = ['learn', 'courage', 'ideas', 'help'];
/** Fixed choices for the youngest mode, in whole major units. */
const PRICE_CHOICES = [1, 3, 5, 10];

export function NewInvoice() {
  const { t } = useTranslation();
  const fb = useFirebase();
  const { familyId, kidId, family, ageMode, status } = useKidSession();
  const [params] = useSearchParams();
  const activityId = params.get('activity');

  const [description, setDescription] = useState('');
  const [priceText, setPriceText] = useState('');
  const [category, setCategory] = useState<Pillar | null>(null);
  const [chosenMajor, setChosenMajor] = useState<number | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const photoFirst = ageMode === '5-8';
  const [photoCount, setPhotoCount] = useState(0);
  // at 5-8 the kid types nothing — the tapped pillar stands in for words — so
  // an invoice with no photo carries neither description nor evidence and is
  // not reviewable. The photo is the description in this mode, so sending
  // without one is blocked rather than merely discouraged.
  const canSend = !photoFirst || photoCount > 0;

  // prefill from the activity the kid tapped on the board
  useEffect(() => {
    if (!familyId || !activityId || !family) return;
    let live = true;
    void getDoc(doc(fb.db, `families/${familyId}/activities/${activityId}`)).then((snap) => {
      if (!live || !snap.exists()) return;
      const price = snap.get('suggestedPrice') as number;
      const digits = minorDigits(family.currency);
      setPriceText(String(price / 10 ** digits));
      setCategory(snap.get('category') as Pillar);
    });
    return () => { live = false; };
  }, [fb.db, familyId, activityId, family]);

  const choices = useMemo(
    () => (family ? PRICE_CHOICES.map((major) => major * 10 ** minorDigits(family.currency)) : []),
    [family],
  );

  if (status !== 'ready' || !familyId || !kidId || !family) {
    return <div className={styles.screen}><Spinner /></div>;
  }

  async function save() {
    setError(null);
    let amount: number;
    if (photoFirst) {
      if (chosenMajor === null) { setError(t('kidNew.badAmount')); return; }
      amount = chosenMajor;
    } else {
      try {
        amount = parseMajor(priceText.replace(/[^\d.,]/g, ''), family.currency);
      } catch {
        setError(t('kidNew.badAmount'));
        return;
      }
    }
    if (amount <= 0) { setError(t('kidNew.badAmount')); return; }

    // at 5-8 the kid does not type: the tapped category stands in for words,
    // and the photo carries the evidence
    const text = photoFirst
      ? (category ? t(`activities.pillars.${category}`) : '')
      : description.trim();
    if (text === '') { setError(t('kidNew.needDescription')); return; }

    setBusy(true);
    try {
      const id = await createDraft(fb, {
        familyId, kidId, activityId: activityId ?? null,
        description: text, requestedAmount: amount, category,
      });
      setInvoiceId(id); // photos need a server-side invoice to attach to
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.screen}>
      <h1>{t('kidNew.title')}</h1>
      {error && <ErrorBanner message={error} />}

      {invoiceId === null ? (
        <Card label={t('kidNew.title')}>
          {photoFirst ? (
            <>
              <p>{t('kidNew.pickCategory')}</p>
              <div className={styles.pillars}>
                {PILLARS.map((pillar) => (
                  <Button
                    key={pillar}
                    variant={category === pillar ? 'primary' : 'secondary'}
                    onClick={() => setCategory(pillar)}
                  >
                    <PillarIcon pillar={pillar} /> {t(`activities.pillars.${pillar}`)}
                  </Button>
                ))}
              </div>
              <p>{t('kidNew.pickPrice')}</p>
              <div className={styles.prices}>
                {choices.map((minor) => (
                  <Button
                    key={minor}
                    data-testid="price-choice"
                    variant={chosenMajor === minor ? 'primary' : 'secondary'}
                    onClick={() => setChosenMajor(minor)}
                  >
                    <Money amount={minor} />
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* the spec's free-form path is "picks category, writes
                  description, sets their own price" — so the picker is here
                  too, not only in the youngest mode. An invoice raised from
                  the board already knows its pillar. */}
              {!activityId && (
                <>
                  <p>{t('kidNew.pickCategory')}</p>
                  <div className={styles.pillars}>
                    {PILLARS.map((pillar) => (
                      <Button
                        key={pillar}
                        variant={category === pillar ? 'primary' : 'secondary'}
                        onClick={() => setCategory(pillar)}
                      >
                        <PillarIcon pillar={pillar} /> {t(`activities.pillars.${pillar}`)}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              <label htmlFor="inv-what">{t('kidNew.what')}</label>
              <small>{t('kidNew.whatHint')}</small>
              <textarea
                id="inv-what" value={description} maxLength={1000}
                onChange={(e) => setDescription(e.target.value)}
              />
              <label htmlFor="inv-price">{t('kidNew.howMuch')}</label>
              <input
                id="inv-price" inputMode="decimal" value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
              />
            </>
          )}
          <Button disabled={busy} onClick={save}>{t('kidNew.save')}</Button>
        </Card>
      ) : (
        <>
          <p role="status">{t('kidNew.saved')}</p>
          <InvoicePhotos familyId={familyId} kidId={kidId} invoiceId={invoiceId} />
        </>
      )}
    </div>
  );
}
```

`app/src/screens/kid/InvoicePhotos.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDownloadURL, ref } from 'firebase/storage';
import { useFirebase } from '../../firebase/FirebaseContext.js';
import { useDoc } from '../../hooks/useDoc.js';
import { uploadInvoicePhoto, removeInvoicePhoto, MAX_PHOTOS } from '../../lib/photos.js';
import { Button } from '../../components/Button.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import styles from './NewInvoice.module.css';

export function InvoicePhotos({ familyId, kidId, invoiceId, onCountChange }: {
  familyId: string; kidId: string; invoiceId: string;
  onCountChange?: (count: number) => void;
}) {
  const { t } = useTranslation();
  const fb = useFirebase();
  const invoice = useDoc<{ photoPaths: string[] }>(`families/${familyId}/invoices/${invoiceId}`);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const paths = invoice.data?.photoPaths ?? [];

  // the count drives the 5-8 send gate, so it is reported upward from the
  // one place that actually knows it: the invoice document
  useEffect(() => { onCountChange?.(paths.length); }, [paths.length, onCountChange]);

  // thumbnails: resolve each path once, and forget any that has been removed
  useEffect(() => {
    let live = true;
    void Promise.all(paths.map(async (path) => {
      if (urls[path]) return [path, urls[path]!] as const;
      const url = await getDownloadURL(ref(fb.storage, path)).catch(() => null);
      return [path, url] as const;
    })).then((pairs) => {
      if (!live) return;
      setUrls(Object.fromEntries(
        pairs.filter((pair): pair is readonly [string, string] => pair[1] !== null),
      ));
    });
    return () => { live = false; };
  }, [paths.join('|'), fb.storage]);

  async function add(file: File) {
    if (paths.length >= MAX_PHOTOS) {
      setError(t('kidNew.photoLimit'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadInvoicePhoto(fb, { familyId, kidId, invoiceId, file });
    } catch {
      setError(t('kidNew.photoFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(path: string) {
    setBusy(true);
    setError(null);
    try {
      await removeInvoicePhoto(fb, { familyId, invoiceId, path });
    } catch {
      setError(t('kidNew.photoFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>{t('kidNew.photos')} ({paths.length}/{MAX_PHOTOS})</h2>
      {error && <ErrorBanner message={error} />}
      <input
        ref={input} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void add(file);
          e.target.value = '';
        }}
      />
      <Button disabled={busy || paths.length >= MAX_PHOTOS} onClick={() => input.current?.click()}>
        {t('kidNew.addPhoto')}
      </Button>
      <ul className={styles.thumbs}>
        {paths.map((path) => (
          <li key={path}>
            {urls[path]
              ? <img src={urls[path]} alt="" data-testid="photo-thumb" />
              : <span data-testid="photo-thumb-pending" />}
            <Button variant="danger" disabled={busy} onClick={() => void remove(path)}>
              {t('kidNew.removePhoto')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`app/src/screens/kid/NewInvoice.module.css`:
```css
.screen { padding: var(--s-4) var(--s-4) calc(var(--tap) + var(--s-6)); }
.screen textarea, .screen input {
  display: block; width: 100%; margin-bottom: var(--s-3);
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--c-line); border-radius: var(--radius);
}
.screen label { display: block; font-size: var(--f-small); color: var(--c-ink-soft); }
.pillars, .prices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: var(--s-2);
  margin-bottom: var(--s-4);
}
.thumbs {
  list-style: none;
  margin: var(--s-3) 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
  gap: var(--s-2);
}
.thumbs img { width: 100%; border-radius: var(--radius); display: block; }
```

Register the route: `kidRoutes` gets `{ path: 'new', element: <NewInvoice /> }`, and `KID_TABS` gets `{ to: '/kid/new', labelKey: 'kidNav.new' }`.

**Photo upload is not covered by a component test.** jsdom cannot produce a real encoded image, and the Storage emulator would reject the stub blob's contents; the compression arithmetic and limits are unit-tested above, and Task 13's Playwright run uploads a real file through a real browser. That split is deliberate.

- [ ] **Step 5: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add app
git commit -m "feat(app): invoice builder with photo compression and a photo-first 5-8 mode"
```

---

### Task 7: Send and resend

**Files:**
- Modify: `app/src/lib/kidInvoice.ts`, `app/src/lib/kidInvoice.test.ts`, `app/src/screens/kid/NewInvoice.tsx`, `app/src/screens/kid/NewInvoice.test.tsx`

**Interfaces:**
- Produces: `sendInvoice(fb, { familyId, invoice, note? }): Promise<void>` — the batched transition into `sent` from any of `draft | returned | countered`, carrying the event **with `requestedAmount`**, which the rules require on every `→ sent` transition and forbid elsewhere.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/lib/kidInvoice.test.ts`:
```ts
describe('sendInvoice', () => {
  it('sends a draft with a matching event that snapshots the amount', async () => {
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null, description: 'Leí un libro', requestedAmount: 5000,
    });
    const before = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    await sendInvoice(kidFb, {
      familyId,
      invoice: { id, ...before.data() } as never,
    });

    const after = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    expect(after.get('status')).toBe('sent');
    expect(after.get('eventCount')).toBe(1);
    const event = await getDocFromServer(
      doc(kidFb.db, `families/${familyId}/invoices/${id}/events/e1`),
    );
    expect(event.get('from')).toBe('draft');
    expect(event.get('to')).toBe('sent');
    expect(event.get('kidId')).toBe('k1');
    expect(event.get('actorUid')).toBe(`kid_${familyId}_k1`);
    // the amount as of THIS send, so the negotiation history survives edits
    expect(event.get('requestedAmount')).toBe(5000);
  });

  it('resends a returned invoice at a revised amount, keeping both events', async () => {
    await seedDoc(`families/${familyId}/invoices/ret1`, {
      kidId: 'k1', activityId: null, description: 'primera', photoPaths: [],
      status: 'returned', requestedAmount: 5000, eventCount: 2, createdAt: new Date(),
    });
    await updateDraft(kidFb, {
      familyId, invoiceId: 'ret1', status: 'returned',
      fields: { description: 'mejor explicado', requestedAmount: 6000 },
    });
    const current = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/ret1`));
    await sendInvoice(kidFb, { familyId, invoice: { id: 'ret1', ...current.data() } as never });

    const after = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/ret1`));
    expect(after.get('status')).toBe('sent');
    expect(after.get('eventCount')).toBe(3);
    const event = await getDocFromServer(
      doc(kidFb.db, `families/${familyId}/invoices/ret1/events/e3`),
    );
    expect(event.get('from')).toBe('returned');
    expect(event.get('requestedAmount')).toBe(6000); // the revised ask
  });

  it('refuses to send from a status the rules do not allow', async () => {
    await seedDoc(`families/${familyId}/invoices/appr1`, {
      kidId: 'k1', activityId: null, description: 'x', photoPaths: [],
      status: 'approved', requestedAmount: 100, approvedAmount: 100, netAmount: 100,
      deductions: [], eventCount: 2, createdAt: new Date(),
    });
    const snap = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/appr1`));
    await expect(
      sendInvoice(kidFb, { familyId, invoice: { id: 'appr1', ...snap.data() } as never }),
    ).rejects.toThrow(/sent from/i);
  });

  it('rejects an over-long note before writing anything', async () => {
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null, description: 'x', requestedAmount: 100,
    });
    const snap = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    await expect(sendInvoice(kidFb, {
      familyId, invoice: { id, ...snap.data() } as never, note: 'x'.repeat(501),
    })).rejects.toThrow(/note/i);
    expect((await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/${id}`)))
      .get('status')).toBe('draft');
  });
});
```
Add `sendInvoice` to the imports at the top of the file.

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npm run test:app` → FAIL (`sendInvoice` is not exported).

Append to `app/src/lib/kidInvoice.ts`:
```ts
import { serverTimestamp, writeBatch } from 'firebase/firestore';
import type { InvoiceDoc } from './invoiceActions.js';

const MAX_NOTE = 500;
const SENDABLE = ['draft', 'returned', 'countered'] as const;

/**
 * Transition into `sent`, batched with its event — the invoice rule requires
 * existsAfter(events/e{newEventCount}) and the event rule checks `from`
 * against the pre-batch status, so neither write survives alone.
 *
 * `requestedAmount` on the event is required by the rules for every `→ sent`
 * transition and forbidden on any other: it snapshots the ask as of this
 * send, which is what keeps the negotiation history readable after a revision.
 */
export async function sendInvoice(fb: FirebaseBundle, args: {
  familyId: string;
  invoice: InvoiceDoc;
  note?: string;
}): Promise<void> {
  const uid = fb.auth.currentUser?.uid;
  if (!uid) throw new Error('no kid session');
  if (!SENDABLE.includes(args.invoice.status as typeof SENDABLE[number])) {
    throw new Error(`an invoice cannot be sent from ${args.invoice.status}`);
  }
  const note = args.note ?? '';
  if (note.length > MAX_NOTE) throw new Error(`note must be at most ${MAX_NOTE} characters`);

  const nextCount = args.invoice.eventCount + 1;
  const batch = writeBatch(fb.db);
  batch.update(doc(fb.db, `families/${args.familyId}/invoices/${args.invoice.id}`), {
    status: 'sent', eventCount: nextCount,
  });
  batch.set(
    doc(fb.db, `families/${args.familyId}/invoices/${args.invoice.id}/events/e${nextCount}`),
    {
      from: args.invoice.status, to: 'sent', actorUid: uid,
      at: serverTimestamp(), note, kidId: args.invoice.kidId,
      requestedAmount: args.invoice.requestedAmount,
    },
  );
  await batch.commit();
}
```

- [ ] **Step 3: Wire the send button — without it a draft can never leave the device**

Task 6 leaves a saved draft on screen with its photo picker and no way to send it. Add the button there, and a test that proves the whole create-then-send path.

Append to `app/src/screens/kid/NewInvoice.test.tsx`:
```tsx
describe('photos', () => {
  it('a 5-8 invoice cannot be sent until a photo has synced', async () => {
    await signInTestKid(await seedKid(2020)); // age 6
    renderNew();
    await userEvent.click(await screen.findByRole('button', { name: /valentía/i }));
    await userEvent.click(screen.getAllByTestId('price-choice')[0]!);
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));

    // at this age the kid typed nothing, so with no photo there is nothing
    // for a parent to review — the send button stays disabled and says why
    const send = await screen.findByRole('button', { name: /enviar/i });
    expect(send).toBeDisabled();
    expect(screen.getByText(/agrega una foto/i)).toBeInTheDocument();
  });

  it('an 8-12 invoice can be sent without a photo, because it has words', async () => {
    await signInTestKid(await seedKid(2016));
    renderNew();
    await userEvent.type(await screen.findByLabelText(/qué hiciste/i), 'Ordené mi cuarto');
    await userEvent.type(screen.getByLabelText(/cuánto/i), '4000');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    expect(await screen.findByRole('button', { name: /enviar/i })).toBeEnabled();
  });

  it('removing a photo detaches it from the invoice', async () => {
    await signInTestKid(await seedKid(2016));
    renderNew();
    await userEvent.type(await screen.findByLabelText(/qué hiciste/i), 'Con foto');
    await userEvent.type(screen.getByLabelText(/cuánto/i), '1000');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await screen.findByRole('button', { name: /agregar foto/i });

    // the upload itself needs a real browser (see the gap note below), so
    // attach the path the way a completed upload would and prove the removal
    const all = await invoices();
    const id = all.docs[0]!.id;
    const path = `families/${familyId}/kids/k1/invoices/${id}/seeded.jpg`;
    await seedDoc(`families/${familyId}/invoices/${id}`, {
      ...(all.docs[0]!.data() as Record<string, never>), photoPaths: [path],
    });
    await userEvent.click(await screen.findByRole('button', { name: /quitar/i }));
    await waitFor(async () => {
      const after = await invoices();
      expect(after.docs[0]!.get('photoPaths')).toEqual([]);
    }, { timeout: 5000 });
  });
});

describe('sending from the builder', () => {
  it('saves a draft, then sends it with its event', async () => {
    await signInTestKid(await seedKid(2016));
    renderNew();
    await userEvent.type(await screen.findByLabelText(/qué hiciste/i), 'Ordené mi cuarto');
    await userEvent.type(screen.getByLabelText(/cuánto/i), '4000');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));

    // the draft exists and the send button appears only now, because photos
    // and sending both need an invoice that has reached the server
    await userEvent.click(await screen.findByRole('button', { name: /enviar/i }));
    await waitFor(async () => {
      const all = await invoices();
      expect(all.size).toBe(1);
      expect(all.docs[0]!.get('status')).toBe('sent');
      expect(all.docs[0]!.get('eventCount')).toBe(1);
    }, { timeout: 5000 });
  });
});
```

In `NewInvoice.tsx`, import `sendInvoice` and `useDoc`, and render the button beside the photo picker:
```tsx
      ) : (
        <>
          <p role="status">{t('kidNew.saved')}</p>
          <InvoicePhotos
            familyId={familyId} kidId={kidId} invoiceId={invoiceId}
            onCountChange={setPhotoCount}
          />
          {!canSend && <p role="status">{t('kidNew.needPhoto')}</p>}
          <Button
            disabled={busy || !canSend}
            onClick={() => run(async () => {
              // read the invoice back rather than reconstructing it: the send
              // needs the server's eventCount and status, not our guesses
              const snap = await getDoc(doc(fb.db, `families/${familyId}/invoices/${invoiceId}`));
              await sendInvoice(fb, {
                familyId,
                invoice: { id: invoiceId, ...snap.data() } as InvoiceDoc,
              });
              navigate('/kid/invoices');
            })}
          >
            {t('kidNew.send')}
          </Button>
        </>
      )}
```
with a `run()` helper matching the one in `InvoiceNegotiation` (set busy, clear error, catch to `common.error`) and `useNavigate` from `react-router-dom`.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS.

```bash
git add app
git commit -m "feat(app): kid send and resend with amount-snapshotting events"
```

---

### Task 8: Accept a counter-offer, and celebrate

**Files:**
- Create: `app/src/screens/kid/InvoiceNegotiation.tsx`, `app/src/screens/kid/InvoiceNegotiation.test.tsx`, `app/src/components/Celebrate.tsx`, `app/src/components/Celebrate.module.css`
- Modify: `app/src/kid/kidRoutes.tsx`, `app/src/i18n/*.json`

**Interfaces:**
- Consumes: `acceptCounterOffer` (Plan 1 — the one callable a *kid* may invoke, and it approves strictly at the parent's recorded `counterOffer.amount`), `sendInvoice`, `updateDraft`.
- Produces: `<InvoiceNegotiation />` at `/kid/invoice/:invoiceId`; `<Celebrate>` — a short, reduced-motion-respecting animation on approval.

**It must handle three statuses, not one.** The history screen (Task 9) links here for `draft`, `returned` **and** `countered`, so this screen is where a kid finishes any unsent invoice: a `countered` one offers accept-or-argue, a `returned` one offers edit-and-resend, and a `draft` one offers photos-and-send. A screen that only knew about `countered` would dead-end the other two.

- [ ] **Step 1: Write the failing test**

`app/src/screens/kid/InvoiceNegotiation.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { doc, getDocFromServer, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../../firebase.js';

const kidFb = kidBundle();
import { callables } from '../../lib/callables.js';
import { initI18n } from '../../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../../test/emulator.js';
import { KidSessionProvider } from '../../kid/KidSessionContext.js';
import { InvoiceNegotiation } from './InvoiceNegotiation.js';

const familyId = 'famNeg';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidFb.auth); });

async function seedCountered(counterAmount: number): Promise<void> {
  await signInTestParent('negparent');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  await batch.commit();
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear: 2016, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  await seedDoc(`families/${familyId}/invoices/inv1`, {
    kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
    status: 'countered', requestedAmount: 8000, eventCount: 2, createdAt: new Date(),
    counterOffer: { amount: counterAmount, note: 'un poco menos', parentId: uid, at: new Date() },
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  await signInTestKid(data.code);
}

function renderNegotiation() {
  return render(
    <MemoryRouter initialEntries={['/kid/invoice/inv1']}>
      <KidSessionProvider>
        <Routes>
          <Route path="/kid/invoice/:invoiceId" element={<InvoiceNegotiation />} />
        </Routes>
      </KidSessionProvider>
    </MemoryRouter>,
  );
}

describe('InvoiceNegotiation', () => {
  it('shows both amounts so the choice is legible', async () => {
    await seedCountered(5000);
    renderNegotiation();
    await waitFor(() => expect(screen.getByTestId('asked')).toHaveTextContent(/8[.,]?000/));
    expect(screen.getByTestId('offered')).toHaveTextContent(/5[.,]?000/);
    expect(screen.getByText(/un poco menos/)).toBeInTheDocument();
  });

  it('accepting approves at the parent’s amount and credits the balance', async () => {
    await seedCountered(5000);
    renderNegotiation();
    await userEvent.click(await screen.findByRole('button', { name: /aceptar/i }));
    await waitFor(async () => {
      const snap = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/inv1`));
      expect(snap.get('status')).toBe('approved');
      // strictly the counter amount, never the kid's original ask
      expect(snap.get('approvedAmount')).toBe(5000);
    }, { timeout: 5000 });
    expect((await getDocFromServer(doc(kidFb.db, `families/${familyId}/kids/k1`)))
      .get('spendableBalance')).toBe(5000);
    expect(await screen.findByTestId('celebrate')).toBeInTheDocument();
  });

  it('revising and resending keeps the kid’s own price', async () => {
    await seedCountered(5000);
    renderNegotiation();
    await userEvent.clear(await screen.findByLabelText(/explica/i));
    await userEvent.type(screen.getByLabelText(/explica/i), 'Me tomó tres días');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(async () => {
      const snap = await getDocFromServer(doc(kidFb.db, `families/${familyId}/invoices/inv1`));
      expect(snap.get('status')).toBe('sent');
      expect(snap.get('description')).toBe('Me tomó tres días');
      expect(snap.get('requestedAmount')).toBe(8000); // unchanged ask
    }, { timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npm run test:app` → FAIL (no `InvoiceNegotiation.js`).

Add to `es.json` (mirror in `en.json`):
```json
  "kidNegotiation": {
    "title": "Tu factura",
    "asked": "Pediste",
    "offered": "Te ofrecen",
    "accept": "Aceptar {{amount}}",
    "explain": "Explica por qué vale lo que pediste",
    "resend": "Enviar otra vez",
    "approved": "¡Aprobada!",
    "celebrate": "¡Bien hecho!"
  }
```
(`en`: `"title": "Your invoice", "asked": "You asked for", "offered": "They offer", "accept": "Accept {{amount}}", "explain": "Explain why it is worth what you asked", "resend": "Send again", "approved": "Approved!", "celebrate": "Nice work!"`)

`app/src/components/Celebrate.tsx`:
```tsx
import { useTranslation } from 'react-i18next';
import styles from './Celebrate.module.css';

/** Small, brief, and silent — and it respects prefers-reduced-motion. */
export function Celebrate() {
  const { t } = useTranslation();
  return (
    <p role="status" data-testid="celebrate" className={styles.celebrate}>
      🎉 {t('kidNegotiation.celebrate')}
    </p>
  );
}
```

`app/src/components/Celebrate.module.css`:
```css
.celebrate {
  font-size: var(--f-money);
  font-weight: 800;
  color: var(--c-money);
  text-align: center;
  animation: pop 420ms ease-out;
}
@keyframes pop {
  from { transform: scale(0.7); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
/* a celebration must never be a vestibular problem */
@media (prefers-reduced-motion: reduce) {
  .celebrate { animation: none; }
}
```

`app/src/screens/kid/InvoiceNegotiation.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { formatMinor } from '@money-kids/shared';
import { useFirebase } from '../../firebase/FirebaseContext.js';
import { useDoc } from '../../hooks/useDoc.js';
import { useKidSession } from '../../kid/KidSessionContext.js';
import { callables } from '../../lib/callables.js';
import { sendInvoice, updateDraft } from '../../lib/kidInvoice.js';
import { Button } from '../../components/Button.js';
import { Card } from '../../components/Card.js';
import { Celebrate } from '../../components/Celebrate.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { Money } from '../../components/Money.js';
import { Spinner } from '../../components/Spinner.js';
import type { InvoiceDoc } from '../../lib/invoiceActions.js';
import styles from './NewInvoice.module.css';

export function InvoiceNegotiation() {
  const { t } = useTranslation();
  const { invoiceId } = useParams();
  const fb = useFirebase();
  const { familyId, family, status } = useKidSession();
  const invoice = useDoc<InvoiceDoc>(
    familyId && invoiceId ? `families/${familyId}/invoices/${invoiceId}` : null,
  );
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const data = invoice.data;

  useEffect(() => { if (data) setText(data.description); }, [data?.id]);

  if (status !== 'ready' || !familyId || !family || invoice.loading) {
    return <div className={styles.screen}><Spinner /></div>;
  }
  if (invoice.error || !data) return <div className={styles.screen}><ErrorBanner /></div>;

  const counter = data.counterOffer;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.screen}>
      <h1>{t('kidNegotiation.title')}</h1>
      {error && <ErrorBanner message={error} />}
      {data.status === 'approved' && <Celebrate />}

      <Card label={t('kidNegotiation.title')}>
        <p data-testid="asked">{t('kidNegotiation.asked')}: <Money amount={data.requestedAmount} /></p>
        {counter && (
          <>
            <p data-testid="offered">
              {t('kidNegotiation.offered')}: <Money amount={counter.amount} />
            </p>
            {counter.note ? <p>{counter.note}</p> : null}
          </>
        )}
      </Card>

      {/* draft and returned both need edit-and-send; only countered offers
          an amount to accept */}
      {(data.status === 'draft' || data.status === 'returned'
        || data.status === 'countered') && (
        <>
          {data.status === 'countered' && counter && (
          <Button
            disabled={busy}
            onClick={() => run(() => callables(fb).acceptCounterOffer({
              familyId, invoiceId: data.id,
            }))}
          >
            {t('kidNegotiation.accept', {
              amount: formatMinor(counter.amount, family.currency,
                family.language === 'es' ? 'es-CO' : 'en-US'),
            })}
          </Button>
          )}

          <label htmlFor="neg-text">{t('kidNegotiation.explain')}</label>
          <textarea
            id="neg-text" value={text} maxLength={1000}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            variant="secondary" disabled={busy}
            onClick={() => run(async () => {
              // save the better explanation first, then resend at the SAME
              // price: the point of countering back is the argument, not a
              // silent discount
              await updateDraft(fb, {
                familyId, invoiceId: data.id, status: data.status,
                fields: { description: text.trim() },
              });
              await sendInvoice(fb, {
                familyId,
                invoice: { ...data, description: text.trim() },
              });
            })}
          >
            {t('kidNegotiation.resend')}
          </Button>
        </>
      )}
    </div>
  );
}
```

Register the route: `kidRoutes` gets `{ path: 'invoice/:invoiceId', element: <InvoiceNegotiation /> }` (no tab — it is reached from the history list).

- [ ] **Step 3: Verify and commit**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS. If acceptance is denied, check the kid's claims: `acceptCounterOffer` is the one callable a kid may invoke, and only for their **own** invoice in status `countered`.

```bash
git add app
git commit -m "feat(app): counter-offer acceptance and the approval celebration"
```

---

### Task 9: Invoice history, the pay stub, and 12–16 earnings stats

**Files:**
- Create: `app/src/screens/kid/KidInvoices.tsx`, `app/src/screens/kid/KidInvoices.module.css`, `app/src/screens/kid/KidInvoices.test.tsx`
- Modify: `app/src/kid/kidRoutes.tsx`, `app/src/i18n/*.json`

**Interfaces:**
- Consumes: the kid-constrained invoice query (`where('kidId','==',own)` + `orderBy('createdAt','desc')`, using the index from Task 5), `useKidSession`.
- Produces: `<KidInvoices />` at `/kid/invoices` — statuses in kid words, the gross → deductions → net pay stub on approved invoices, and an earnings summary shown **only** at 12–16.

- [ ] **Step 1: Write the failing test**

`app/src/screens/kid/KidInvoices.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { doc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../../firebase.js';

const kidFb = kidBundle();
import { callables } from '../../lib/callables.js';
import { initI18n } from '../../i18n/index.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../../test/emulator.js';
import { KidSessionProvider } from '../../kid/KidSessionContext.js';
import { KidInvoices } from './KidInvoices.js';

const familyId = 'famHist';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); await signOut(kidFb.auth); });

async function seedHistory(birthYear: number): Promise<void> {
  await signInTestParent('histparent');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  await batch.commit();
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear, deductionsEnabled: true,
    spendableBalance: 4000, savingsBalance: 1000,
  });
  await seedDoc(`families/${familyId}/kids/k2`, {
    name: 'Sib', birthYear: 2014, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  await seedDoc(`families/${familyId}/invoices/appr1`, {
    kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
    status: 'approved', requestedAmount: 5000, approvedAmount: 5000, netAmount: 4000,
    deductions: [{
      nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000,
      destination: 'savings', amount: 1000,
    }],
    eventCount: 2, createdAt: new Date('2026-09-01'),
  });
  await seedDoc(`families/${familyId}/invoices/sent1`, {
    kidId: 'k1', activityId: null, description: 'Ordené mi cuarto', photoPaths: [],
    status: 'sent', requestedAmount: 3000, eventCount: 1, createdAt: new Date('2026-09-02'),
  });
  // a sibling's invoice: the kid-constrained query must never surface it
  await seedDoc(`families/${familyId}/invoices/sib1`, {
    kidId: 'k2', activityId: null, description: 'Secreto de mi hermano', photoPaths: [],
    status: 'sent', requestedAmount: 9000, eventCount: 1, createdAt: new Date('2026-09-03'),
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  await signInTestKid(data.code);
}

function renderHistory() {
  return render(
    <MemoryRouter>
      <KidSessionProvider><KidInvoices /></KidSessionProvider>
    </MemoryRouter>,
  );
}

describe('KidInvoices', () => {
  it('lists only this kid’s invoices, newest first', async () => {
    await seedHistory(2016);
    renderHistory();
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ordené mi cuarto'); // Sep 2
    expect(items[1]).toHaveTextContent('Leí un libro');     // Sep 1
    expect(screen.queryByText(/Secreto de mi hermano/)).toBeNull();
  });

  it('shows the pay stub on an approved invoice', async () => {
    await seedHistory(2016);
    renderHistory();
    const stub = await screen.findByTestId('paystub-appr1');
    expect(stub).toHaveTextContent(/5[.,]?000/); // gross
    expect(stub).toHaveTextContent(/Ahorro/);    // the line item, in Spanish
    expect(stub).toHaveTextContent(/1[.,]?000/); // withheld to savings
    expect(stub).toHaveTextContent(/4[.,]?000/); // net
  });

  it('shows earnings stats only in the oldest mode', async () => {
    await seedHistory(2011); // age 15
    renderHistory();
    await waitFor(() => expect(screen.getByTestId('stats')).toBeInTheDocument());
    expect(screen.getByTestId('stats')).toHaveTextContent(/5[.,]?000/); // approved total
  });

  it('hides stats for younger kids', async () => {
    await seedHistory(2020); // age 6
    renderHistory();
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('stats')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npm run test:app` → FAIL (no `KidInvoices.js`).

Add to `es.json` (mirror in `en.json`):
```json
  "kidInvoices": {
    "title": "Mis facturas",
    "empty": "Todavía no has enviado ninguna factura.",
    "statuses": {
      "draft": "Sin enviar",
      "sent": "Esperando respuesta",
      "countered": "Te hicieron otra oferta",
      "returned": "Te pidieron más detalles",
      "approved": "Aprobada"
    },
    "gross": "Te aprobaron",
    "net": "Te quedó para gastar",
    "toSavings": "Se guardó en tu ahorro",
    "withheld": "Se retuvo",
    "stats": "Lo que has ganado",
    "statsApproved": "Aprobado en total",
    "statsCount": "Facturas aprobadas",
    "open": "Ver"
  }
```
(`en`: `"title": "My invoices", "empty": "You have not sent any invoices yet.", "statuses": { "draft": "Not sent", "sent": "Waiting for an answer", "countered": "They made a different offer", "returned": "They asked for more detail", "approved": "Approved" }, "gross": "They approved", "net": "You can spend", "toSavings": "Saved in your savings", "withheld": "Held back", "stats": "What you have earned", "statsApproved": "Approved in total", "statsCount": "Approved invoices", "open": "Open"`)

`app/src/screens/kid/KidInvoices.tsx`:
```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { useFirebase } from '../../firebase/FirebaseContext.js';
import { useCollection } from '../../hooks/useCollection.js';
import { useKidSession } from '../../kid/KidSessionContext.js';
import { Card } from '../../components/Card.js';
import { Money } from '../../components/Money.js';
import { Spinner } from '../../components/Spinner.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import type { InvoiceDoc } from '../../lib/invoiceActions.js';
import styles from './KidInvoices.module.css';

export function KidInvoices() {
  const { t, i18n } = useTranslation();
  const { db } = useFirebase();
  const { familyId, kidId, ageMode, status } = useKidSession();

  // the rules do not filter queries: this MUST be constrained by kidId, or
  // the whole read is denied rather than trimmed
  const invoices = useCollection<InvoiceDoc>(
    familyId && kidId
      ? query(
          collection(db, `families/${familyId}/invoices`),
          where('kidId', '==', kidId),
          orderBy('createdAt', 'desc'),
        )
      : null,
  );

  if (status !== 'ready') return <div className={styles.screen}><Spinner /></div>;
  if (invoices.error) return <div className={styles.screen}><ErrorBanner /></div>;

  const approved = invoices.docs.filter((i) => i.status === 'approved');
  const approvedTotal = approved.reduce((sum, i) => sum + (i.approvedAmount ?? 0), 0);
  const isEs = i18n.language === 'es';

  return (
    <div className={styles.screen}>
      <h1>{t('kidInvoices.title')}</h1>

      {/* the spec puts earnings stats in the oldest mode only */}
      {ageMode === '12-16' && approved.length > 0 && (
        <Card label={t('kidInvoices.stats')}>
          <h2>{t('kidInvoices.stats')}</h2>
          <p data-testid="stats">
            {t('kidInvoices.statsApproved')}: <Money amount={approvedTotal} />
            {' · '}
            {t('kidInvoices.statsCount')}: {approved.length}
          </p>
        </Card>
      )}

      {invoices.loading && <Spinner />}
      {!invoices.loading && invoices.docs.length === 0 && <p>{t('kidInvoices.empty')}</p>}

      <ul className={styles.list}>
        {invoices.docs.map((invoice) => (
          <li key={invoice.id}>
            <Card label={invoice.description}>
              <p className={styles.status}>{t(`kidInvoices.statuses.${invoice.status}`)}</p>
              <h3>{invoice.description}</h3>
              <p><Money amount={invoice.requestedAmount} /></p>

              {invoice.status === 'approved' && invoice.deductions && (
                <div data-testid={`paystub-${invoice.id}`} className={styles.stub}>
                  <p>{t('kidInvoices.gross')}: <Money amount={invoice.approvedAmount ?? 0} /></p>
                  {invoice.deductions.map((line) => (
                    <p key={line.nameEn}>
                      {isEs ? line.nameEs : line.nameEn}
                      {' — '}
                      {line.destination === 'savings'
                        ? t('kidInvoices.toSavings')
                        : t('kidInvoices.withheld')}
                      {': −'}<Money amount={line.amount} />
                    </p>
                  ))}
                  <p><strong>
                    {t('kidInvoices.net')}: <Money amount={invoice.netAmount ?? 0} />
                  </strong></p>
                </div>
              )}

              {(invoice.status === 'countered' || invoice.status === 'returned'
                || invoice.status === 'draft') && (
                <Link to={`/kid/invoice/${invoice.id}`}>{t('kidInvoices.open')}</Link>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`app/src/screens/kid/KidInvoices.module.css`:
```css
.screen { padding: var(--s-4) var(--s-4) calc(var(--tap) + var(--s-6)); }
.list { list-style: none; margin: 0; padding: 0; }
.status {
  margin: 0 0 var(--s-1);
  font-size: var(--f-small);
  color: var(--c-ink-soft);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.stub {
  margin-top: var(--s-3);
  padding-top: var(--s-3);
  border-top: 1px dashed var(--c-line);
  font-size: var(--f-small);
}
```

Register: `kidRoutes` gets `{ path: 'invoices', element: <KidInvoices /> }`, `KID_TABS` gets `{ to: '/kid/invoices', labelKey: 'kidNav.invoices' }`.

- [ ] **Step 3: Verify and commit**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS. A `failed-precondition` error naming an index means Task 5's `kidId + createdAt` index is missing from `firestore.indexes.json` — the emulator builds indexes on demand, so this surfaces in production, not here; add it and move on.

```bash
git add app
git commit -m "feat(app): kid invoice history with pay stub and teen earnings stats"
```

---

### Task 10: Profile switcher on a shared device

**What this is and is not:** the spec is explicit that the parent PIN is "a UI convenience lock against casual misuse, not a backend authorization boundary" — the parent's Firebase session stays live on the device. Two instances make that literal: handing the phone to a kid navigates to the kid app and locks the parent view; coming back needs the PIN. **Nothing on the server trusts any of this**; the real deterrents remain the append-only ledger and every approval being visible to all parents.

**Files:**
- Create: `app/src/components/ProfileSwitcher.tsx`, `app/src/components/ProfileSwitcher.test.tsx`
- Modify: `app/src/App.tsx`, `app/src/screens/Settings.tsx`, `app/src/kid/KidShell.tsx`, `app/src/i18n/*.json`

**Interfaces:**
- Consumes: `lockParentView`/`hasPin` (Plan 2), `useKidSession`, `kidFb`.
- Produces: `<ProfileSwitcher />` — from the parent side, "hand the phone to <kid>" (locks the parent view and navigates to `/kid`); from the kid side, "back to a grown-up" (navigates to `/`, where `PinGate` demands the PIN).

- [ ] **Step 1: Write the failing test**

`app/src/components/ProfileSwitcher.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { initI18n } from '../i18n/index.js';
import { clearPin, setPin, isParentViewLocked } from '../lib/pin.js';
import { ProfileSwitcher } from './ProfileSwitcher.js';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

beforeAll(async () => { await initI18n('es'); });
beforeEach(() => { clearPin(); });

function renderSwitcher(direction: 'to-kid' | 'to-parent') {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <ProfileSwitcher direction={direction} />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

describe('ProfileSwitcher', () => {
  it('handing over locks the parent view and goes to the kid app', async () => {
    await setPin('1234');
    renderSwitcher('to-kid');
    await userEvent.click(screen.getByRole('button', { name: /pasar el teléfono/i }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/kid'));
    expect(isParentViewLocked()).toBe(true);
  });

  it('refuses to hand over without a PIN, since nothing would lock', async () => {
    renderSwitcher('to-kid');
    await userEvent.click(screen.getByRole('button', { name: /pasar el teléfono/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(isParentViewLocked()).toBe(false);
    expect(screen.getByTestId('where')).toHaveTextContent('/settings');
  });

  it('coming back just navigates — PinGate is what asks for the PIN', async () => {
    await setPin('1234');
    renderSwitcher('to-parent');
    await userEvent.click(screen.getByRole('button', { name: /volver con un adulto/i }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/'));
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npm run test:app` → FAIL (no `ProfileSwitcher.js`).

Add to `es.json` (mirror in `en.json`):
```json
  "switcher": {
    "toKid": "Pasar el teléfono a un niño",
    "toParent": "Volver con un adulto",
    "needPin": "Primero crea un PIN de adulto, si no la vista de adulto queda abierta."
  }
```
(`en`: `"toKid": "Hand the phone to a kid", "toParent": "Back to a grown-up", "needPin": "Set an adult PIN first, or the adult view stays open."`)

`app/src/components/ProfileSwitcher.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { hasPin, lockParentView } from '../lib/pin.js';
import { Button } from './Button.js';
import { ErrorBanner } from './ErrorBanner.js';

/**
 * Both sessions stay signed in — that is the point of two Firebase instances.
 * Handing the phone over only locks the parent VIEW; the parent's session is
 * still live underneath, exactly as the spec's threat model describes, and no
 * rule or callable trusts this lock.
 */
export function ProfileSwitcher({ direction }: { direction: 'to-kid' | 'to-parent' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  if (direction === 'to-parent') {
    // no PIN check here: PinGate guards the parent shell itself, so a kid
    // tapping this lands on the prompt rather than in the parent view
    return (
      <Button variant="secondary" onClick={() => navigate('/')}>
        {t('switcher.toParent')}
      </Button>
    );
  }

  return (
    <>
      {error && <ErrorBanner message={error} />}
      <Button
        variant="secondary"
        onClick={() => {
          // locking with no PIN set is a no-op, which would hand a kid an
          // unlocked parent view — refuse instead of pretending
          if (!hasPin()) {
            setError(t('switcher.needPin'));
            return;
          }
          lockParentView();
          navigate('/kid');
        }}
      >
        {t('switcher.toKid')}
      </Button>
    </>
  );
}
```

Place it on both sides: in `Settings.tsx`'s PIN card render `<ProfileSwitcher direction="to-kid" />`, and in `KidShell.tsx` render `<ProfileSwitcher direction="to-parent" />` in a small footer above the tabs (kid-side only, and harmless on a kid-only device — it lands on the parent sign-in).

- [ ] **Step 3: Verify and commit**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS.

```bash
git add app
git commit -m "feat(app): profile switcher for a shared device"
```

---

### Task 11: Offline drafts

**The spec's promise:** "kids can draft invoices offline; they sync later." That needs Firestore's persistent cache, which changes how the instances are constructed.

**Files:**
- Modify: `app/src/firebase.ts`, `app/src/firebase/firebase.test.tsx`, `app/src/screens/kid/JoinKid.tsx`, `app/src/components/ProfileSwitcher.tsx`
- Create: `app/src/lib/offline.test.ts`, `app/src/kid/kidSessionReset.ts`, `app/src/kid/kidSessionReset.test.ts`

**Interfaces:**
- Produces: both bundles built with `persistentLocalCache` when the environment supports it, `memoryLocalCache` otherwise; `disableNetwork`/`enableNetwork` used by the test to prove a draft survives being offline.

- [ ] **Step 1: Write the failing test**

`app/src/lib/offline.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  collection, disableNetwork, doc, enableNetwork, getDocFromCache, getDocFromServer,
  getDocs, writeBatch,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../firebase.js';

// kidBundle() rather than a frozen import: Task 11 replaces the kid instance
// when the kid identity changes, so a module-level const would go stale
const kidFb = kidBundle();
import { callables } from './callables.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../test/emulator.js';
import { createDraft } from './kidInvoice.js';

const familyId = 'famOff';

beforeEach(async () => {
  await clearFirestoreData();
  await signOut(kidFb.auth);
  await signInTestParent('offparent');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  await batch.commit();
  await seedDoc(`families/${familyId}/kids/k1`, {
    name: 'Mia', birthYear: 2016, deductionsEnabled: false,
    spendableBalance: 0, savingsBalance: 0,
  });
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId: 'k1' });
  await signInTestKid(data.code);
});

afterEach(async () => { await enableNetwork(kidFb.db); });

describe('offline drafts', () => {
  it('a draft written offline is readable locally and syncs on reconnect', async () => {
    await disableNetwork(kidFb.db);
    // createDraft does not await the server, so this resolves offline
    const id = await createDraft(kidFb, {
      familyId, kidId: 'k1', activityId: null,
      description: 'Escrito sin internet', requestedAmount: 4000,
    });

    // the kid can still see their own work
    const cached = await getDocFromCache(doc(kidFb.db, `families/${familyId}/invoices/${id}`));
    expect(cached.get('description')).toBe('Escrito sin internet');
    // ...and the server does not have it yet
    const beforeSync = await getDocs(collection(parentFb.db, `families/${familyId}/invoices`));
    expect(beforeSync.size).toBe(0);

    await enableNetwork(kidFb.db);
    // a plain retry loop rather than expect.poll, which is not in every
    // vitest 2.x: this must not depend on the runner's minor version
    let synced = false;
    for (let attempt = 0; attempt < 40 && !synced; attempt += 1) {
      synced = (await getDocFromServer(
        doc(kidFb.db, `families/${familyId}/invoices/${id}`),
      )).exists();
      if (!synced) await new Promise((r) => setTimeout(r, 250));
    }
    expect(synced).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, then switch the cache on**

Run: `npm run test:app` → FAIL (a memory-cache instance cannot serve `getDocFromCache` for an unsynced write in the way this asserts, and the sync assertion will not hold).

In `firebase.ts`, build Firestore explicitly instead of `getFirestore`:
```ts
import {
  initializeFirestore, memoryLocalCache, persistentLocalCache,
  persistentMultipleTabManager, type Firestore,
} from 'firebase/firestore';

/**
 * Persistent cache is what lets a kid draft an invoice with no signal and
 * have it sync later, which the spec requires.
 *
 * It needs IndexedDB. jsdom has none, and a browser in private mode can
 * refuse it, so fall back to the memory cache rather than failing to start:
 * a kid who cannot cache still gets a working online app.
 */
function firestoreFor(app: FirebaseApp): Firestore {
  const canPersist = typeof indexedDB !== 'undefined';
  try {
    return initializeFirestore(app, {
      localCache: canPersist
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : memoryLocalCache(),
    });
  } catch {
    // another call already initialized this app's Firestore (hot reload)
    return getFirestore(app);
  }
}
```
and use `const db = firestoreFor(app);` inside `bundle()`.

Because jsdom has no IndexedDB, the **test suite runs on the memory cache**. `getDocFromCache` still serves a locally buffered write from the memory cache, and `disableNetwork`/`enableNetwork` still queue and flush mutations, so the test above is meaningful in both configurations — what it cannot prove in jsdom is survival across a *reload*. Add that gap to the plan's deliberate-gaps list and cover it in Task 13's Playwright run, which uses a real browser with real IndexedDB.

Add to `firebase.test.tsx`:
```tsx
  it('each instance gets its own cache, so the two sessions cannot collide', () => {
    // distinct app names key distinct IndexedDB databases; if these were the
    // same app, the kid's cached documents and the parent's would share one
    expect(parentFb.db).not.toBe(kidFb.db);
    expect(parentFb.app.name).not.toBe(kidFb.app.name);
  });
```

- [ ] **Step 3: Destroy the kid cache on identity change — the leak this task would otherwise open**

Enabling persistence without this is a data leak on exactly the device the spec cares about: a phone two siblings share. The cache outlives `signOut`, and cache reads bypass rules.

`app/src/kid/kidSessionReset.ts`:
```ts
import { deleteApp } from 'firebase/app';
import { clearIndexedDbPersistence, terminate } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { kidBundle, newKidBundle, replaceKidBundle } from '../firebase.js';

/**
 * Ends a kid session and destroys everything it cached.
 *
 * The order is forced by the SDK and every step is load-bearing:
 *   signOut  — drop the credential first, so nothing can keep reading
 *   terminate— clearIndexedDbPersistence refuses while the instance is live
 *   clear    — the actual erasure; rules never protect cache reads
 *   deleteApp— frees the app NAME so the next initializeApp really builds a
 *              new instance instead of handing back this terminated one
 *   rebuild  — under the same stable name, so a reload finds the right app
 *
 * `deleteApp(app)` is the modular API. There is no `app.delete()`: the v9+
 * `FirebaseApp` interface carries only `name`, `options`, and
 * `automaticDataCollectionEnabled`, so a method call there does not compile.
 */
export async function endKidSession(): Promise<void> {
  const fb = kidBundle();
  await signOut(fb.auth).catch(() => undefined);
  await terminate(fb.db);

  // Best-effort erasure: a browser in private mode can refuse IndexedDB
  // outright. Track the outcome rather than swallowing it — if the cache
  // could NOT be cleared, the next kid must not inherit this instance.
  let cleared = true;
  try {
    await clearIndexedDbPersistence(fb.db);
  } catch {
    cleared = false;
  }

  await deleteApp(fb.app).catch(() => undefined);
  replaceKidBundle(newKidBundle());

  if (!cleared) {
    // the new instance shares the name, and so the on-disk cache we failed
    // to erase. Refuse persistence for the rest of this page's life rather
    // than serve one kid's documents to the next.
    throw new KidCacheNotClearedError();
  }
}

/**
 * Thrown when the kid cache could not be erased. `JoinKid` catches it and
 * asks the kid to close and reopen the app: a fresh page load reinitializes
 * the instance, and if IndexedDB is unavailable the memory-cache fallback in
 * Task 11's Step 2 means there is no shared cache to leak in the first place.
 */
export class KidCacheNotClearedError extends Error {
  constructor() { super('the previous kid’s cached data could not be cleared'); }
}
```

Wire it into **both** ends of the switch — the module is useless unbound:

In `JoinKid.tsx`, add a second error slot — `const [error, setError] = useState<string | null>(null);`, cleared at the top of `join()` and rendered as its own `<ErrorBanner message={error} />` — then reset before redeeming, because a code may be for a different kid than the one already signed in on this device. (The slot lives here rather than in Task 2 so that task ships no setter nothing calls.)
```tsx
      // a different kid may be taking over this device; start from a cache
      // that has never seen the previous kid's documents. If the erasure
      // failed, refuse the sign-in rather than seat Kid B on Kid A's cache.
      if (kidBundle().auth.currentUser) {
        try {
          await endKidSession();
        } catch {
          setError(t('kidJoin.reopen'));
          return;
        }
      }
      const fb = kidBundle();
      const { data } = await callables(fb).mintKidToken({ code: code.trim().toUpperCase() });
      await signInWithCustomToken(fb.auth, data.token);
```

In `ProfileSwitcher.tsx`, the kid-side branch ends the session before handing the phone back:
```tsx
  if (direction === 'to-parent') {
    return (
      <Button
        variant="secondary"
        onClick={async () => {
          // the kid is done with the device: drop their session and cache
          // before the parent view comes back
          await endKidSession();
          navigate('/');
        }}
      >
        {t('switcher.toParent')}
      </Button>
    );
  }
```
This makes `ProfileSwitcher`'s "coming back just navigates" test from Task 10 need one edit: it must now also assert `kidBundle().auth.currentUser` is null afterwards.

`app/src/kid/kidSessionReset.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { doc, getDocFromCache, getDocFromServer, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { parentFb, kidBundle } from '../firebase.js';
import { callables } from '../lib/callables.js';
import { clearFirestoreData, seedDoc, signInTestParent, signInTestKid } from '../test/emulator.js';
import { endKidSession } from './kidSessionReset.js';

const familyId = 'famReset';

beforeEach(async () => {
  await clearFirestoreData();
  await signOut(kidBundle().auth);
  await signInTestParent('resetparent');
  const uid = parentFb.auth.currentUser!.uid;
  const batch = writeBatch(parentFb.db);
  batch.set(doc(parentFb.db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(parentFb.db, `families/${familyId}/members`, uid), {
    role: 'parent', displayName: 'Leo',
  });
  batch.set(doc(parentFb.db, 'parentIndex', uid), { familyId });
  await batch.commit();
  for (const kidId of ['k1', 'k2']) {
    await seedDoc(`families/${familyId}/kids/${kidId}`, {
      name: kidId === 'k1' ? 'Mia' : 'Sib', birthYear: 2016, deductionsEnabled: false,
      spendableBalance: 0, savingsBalance: 0,
    });
  }
});

async function codeFor(kidId: string): Promise<string> {
  const { data } = await callables(parentFb).createJoinCode({ familyId, kidId });
  return data.code;
}

describe('endKidSession', () => {
  it('leaves nothing of the previous kid in the cache', async () => {
    await signInTestKid(await codeFor('k1'));
    const first = kidBundle();
    // warm the cache with something only Mia may read
    await getDocFromServer(doc(first.db, `families/${familyId}/kids/k1`));
    await expect(getDocFromCache(doc(first.db, `families/${familyId}/kids/k1`)))
      .resolves.toBeTruthy();

    await endKidSession();

    const second = kidBundle();
    expect(second.db).not.toBe(first.db);
    expect(second.auth.currentUser).toBeNull();
    // the new instance's cache has never seen Mia's document
    await expect(getDocFromCache(doc(second.db, `families/${familyId}/kids/k1`)))
      .rejects.toThrow();
  });

  it('keeps the app name stable, so a reload finds the same app', async () => {
    await signInTestKid(await codeFor('k1'));
    const firstName = kidBundle().app.name;
    await endKidSession();
    // a generation-suffixed name would sign the next kid out on reload, when
    // module state resets and re-initializes the original name
    expect(kidBundle().app.name).toBe(firstName);
    await endKidSession();
    expect(kidBundle().app.name).toBe(firstName);
  });

  it('lets the next kid sign in on the fresh instance', async () => {
    await signInTestKid(await codeFor('k1'));
    await endKidSession();
    await signInTestKid(await codeFor('k2'));
    expect(kidBundle().auth.currentUser!.uid).toBe(`kid_${familyId}_k2`);
    // and Mia's doc is denied outright, not served from a stale cache
    await expect(getDocFromServer(doc(kidBundle().db, `families/${familyId}/kids/k1`)))
      .rejects.toThrow();
  });
});
```

**What this test can and cannot prove here:** jsdom has no IndexedDB, so the suite runs on the memory cache and this proves the *instance* is rebuilt and the new cache is empty. That `clearIndexedDbPersistence` really removes the on-disk database is only observable in a real browser — Task 13 adds a Playwright assertion that a second kid on the same profile cannot read the first kid's documents after a reload.

- [ ] **Step 4: Note the one thing offline cannot do**

**Photos need connectivity.** The Storage rule authorizes an upload by reading the linked invoice, so a draft that exists only in the local cache cannot receive photos. `InvoicePhotos` must therefore surface a clear failure rather than a silent one — it already routes upload errors to `kidNew.photoFailed`; add a sentence to that string in both languages: `"Necesitas internet para subir fotos."` / `"You need a connection to upload photos."`

- [ ] **Step 5: Verify and commit**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS.

```bash
git add app
git commit -m "feat(app): offline drafts, with the kid cache destroyed on identity change"
```

---

### Task 12: Installable PWA

**Files:**
- Create: `app/public/icon-192.png`, `app/public/icon-512.png`, `app/public/apple-touch-icon.png`, `app/src/pwa.test.ts`
- Modify: `app/vite.config.ts`, `app/package.json`, `app/index.html`

**Interfaces:**
- Produces: a build that emits a web manifest and a service worker; the app is installable on iOS and Android.

- [ ] **Step 1: Write the failing test**

`app/src/pwa.test.ts` — assert the manifest **contract**, not the plugin's internals:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const config = readFileSync(resolve(here, '../vite.config.ts'), 'utf8');

describe('PWA configuration', () => {
  it('declares the manifest fields an install prompt requires', () => {
    // an install prompt is refused without name, icons at 192 and 512,
    // display standalone, and a start_url
    for (const field of [
      'name', 'short_name', 'start_url', 'display', 'theme_color',
      'icon-192.png', 'icon-512.png', 'standalone',
    ]) {
      expect(config, field).toContain(field);
    }
  });
  it('registers the service worker automatically', () => {
    expect(config).toContain('registerType');
  });
});
```

- [ ] **Step 2: Install and configure**

```bash
npm install -D vite-plugin-pwa -w @money-kids/app
```

`app/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Money Kids',
        short_name: 'Money Kids',
        description: 'Facturas de verdad para niños',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fdfbf7',
        theme_color: '#0b7285',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // the app shell only: Firestore and Storage do their own caching, and
        // a service worker caching authenticated API responses is how you
        // serve one family's data to another
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/__/],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
});
```

Add the theme colour and Apple meta tags to `app/index.html`'s `<head>`:
```html
    <meta name="theme-color" content="#0b7285" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

**Icons:** generate three PNGs from one source with a plain script rather than committing binaries by hand — a coin glyph on the accent colour is enough for v1:
```bash
# any of these works; pick what the machine has
# ImageMagick:
magick -size 512x512 xc:'#0b7285' -gravity center -pointsize 320 \
  -fill '#fdfbf7' -annotate 0 '¢' app/public/icon-512.png
magick app/public/icon-512.png -resize 192x192 app/public/icon-192.png
magick app/public/icon-512.png -resize 180x180 app/public/apple-touch-icon.png
```
If ImageMagick is unavailable, write a 12-line Node script using `sharp`, or export from any editor — but **do not skip the icons**: an install prompt without a 192 and a 512 icon is silently refused by Chrome.

- [ ] **Step 3: Verify**

Run: `npm run test:app && npm run build:app && npm run typecheck -w @money-kids/app`
Expected: tests PASS; the build emits `dist/manifest.webmanifest` and `dist/sw.js`. Confirm with `ls app/dist | grep -E 'manifest|sw'`.

- [ ] **Step 4: Commit**

```bash
git add app
git commit -m "feat(app): installable PWA with an app-shell service worker"
```

---

### Task 13: Playwright end-to-end — the whole loop in a real browser

**What this covers that nothing else can:** a real image encoder (so real photo compression and a real Storage upload), real IndexedDB (so persistence across a reload), the Google-free sign-in path end to end, and the two sessions coexisting in one browser profile.

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/invoice-loop.spec.ts`, `e2e/fixtures/photo.png`
- Modify: root `package.json`

**Interfaces:**
- Produces: `npm run test:e2e` — starts the emulators, builds the functions bundle, runs Vite, and drives the full loop at a mobile viewport.

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Configure it**

`e2e/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// absolute, derived from this file: a relative `cwd: '..'` is ambiguous —
// depending on resolution it lands either at the repo root or one directory
// above it, and the second silently runs some other project's `npm run dev`
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // one worker: every test shares one emulator, and they wipe Firestore
  workers: 1,
  fullyParallel: false,
  use: {
    ...devices['Pixel 5'],           // the spec is mobile-first
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    cwd: repoRoot,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

Add the root script — the emulators wrap Playwright, exactly as they wrap the other suites:
```json
    "test:e2e": "npm run build -w @money-kids/functions && firebase emulators:exec --only firestore,auth,functions,storage --project money-kids-test \"npx playwright test --config e2e/playwright.config.ts\""
```

- [ ] **Step 3: Add the dev-only probe seam**

The cache-isolation test has to ask a question no UI assertion can answer — *is the previous kid's document still readable from this device?* — and Playwright cannot import the Firestore SDK into the page (Vite serves bare specifiers only through transformed modules, so a runtime `import('firebase/firestore')` inside `page.evaluate` does not resolve). Expose the two reads from inside the bundle instead, and only in development:

In `app/src/main.tsx`, after i18n initializes:
```tsx
if (import.meta.env.DEV) {
  // test seam, dev builds only: the e2e cache-isolation spec needs to attempt
  // a read from the kid instance's cache and from the server. Never shipped —
  // import.meta.env.DEV is statically false in `vite build`, so this whole
  // block is dropped from the production bundle.
  const { doc, getDocFromCache, getDocFromServer } = await import('firebase/firestore');
  (window as unknown as { __mk: unknown }).__mk = {
    cachedRead: async (path: string) => {
      try {
        return (await getDocFromCache(doc(kidBundle().db, path))).exists();
      } catch {
        return false; // not in the cache at all
      }
    },
    serverRead: async (path: string) => {
      try {
        await getDocFromServer(doc(kidBundle().db, path));
        return 'allowed';
      } catch (e) {
        return (e as { code?: string }).code ?? 'error';
      }
    },
  };
}
```
Confirm it is really absent from production with `npm run build:app && grep -c '__mk' app/dist/assets/*.js` → `0`.

- [ ] **Step 4: Write the spec**

`e2e/invoice-loop.spec.ts` — this is the spec's own acceptance test: sign up → add kid → kid invoices with a photo → parent approves → balance updates → payout.
```ts
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT = 'money-kids-test';

async function wipe(): Promise<void> {
  for (const url of [
    `http://127.0.0.1:8480/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`,
  ]) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(`wipe failed: ${url} ${res.status}`);
  }
}

/** Reads the ids the cache probe needs, bypassing rules like the seeder does. */
async function ids(): Promise<{ familyId: string; firstKidId: string }> {
  const head = { Authorization: 'Bearer owner' };
  const base = `http://127.0.0.1:8480/v1/projects/${PROJECT}/databases/(default)/documents`;
  const families = (await (await fetch(`${base}/families`, { headers: head })).json())
    .documents as { name: string }[];
  const familyId = families[0]!.name.split('/').pop()!;
  const kids = (await (await fetch(`${base}/families/${familyId}/kids`, { headers: head }))
    .json()).documents as { name: string; createTime: string }[];
  const oldest = kids.sort(
    (a, b) => Date.parse(a.createTime) - Date.parse(b.createTime),
  )[0]!;
  return { familyId, firstKidId: oldest.name.split('/').pop()! };
}

async function signUpParent(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel(/correo/i).fill(`e2e-${Date.now()}@example.test`);
  await page.getByLabel(/contraseña/i).fill('test-password');
  await page.getByRole('button', { name: /crear cuenta/i }).click();
  await expect(page.getByLabel(/nombre de la familia/i)).toBeVisible();
}

test.beforeEach(async () => { await wipe(); });

test('the whole invoice loop, on a phone-sized screen', async ({ page }) => {
  // --- parent: sign up and create the family ---
  await signUpParent(page);
  await page.getByLabel(/nombre de la familia/i).fill('Talero');
  await page.getByLabel(/moneda/i).selectOption('COP');
  await page.getByRole('button', { name: /crear familia/i }).click();

  // --- parent: add a kid and take the join code ---
  await page.getByRole('link', { name: /niños/i }).click();
  await page.getByLabel(/^nombre$/i).fill('Mia');
  await page.getByLabel(/año de nacimiento/i).fill('2016');
  await page.getByRole('button', { name: /agregar niño/i }).click();
  const card = page.getByRole('group', { name: /Mia/ });
  await card.getByRole('button', { name: /mostrar código/i }).click();
  const code = (await card.getByTestId('join-code').textContent())!.trim();
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

  // --- parent: turn deductions on, so the pay stub has something to show ---
  await page.getByRole('link', { name: /ajustes/i }).click();
  await page.getByRole('button', { name: /paquete inicial/i }).click();
  await expect(page.getByText(/20\.00%/)).toBeVisible();

  // --- kid: redeem the code in the SAME browser, on the kid instance ---
  await page.goto('/kid');
  await page.getByLabel(/código/i).fill(code);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page.getByRole('heading', { name: /Hola, Mia/ })).toBeVisible();

  // --- kid: build an invoice, with a real photo through real compression ---
  await page.goto('/kid/new');
  await page.getByLabel(/qué hiciste/i).fill('Leí El principito y te lo conté');
  await page.getByLabel(/cuánto/i).fill('5000');
  await page.getByRole('button', { name: /guardar/i }).click();
  await expect(page.getByText(/ahora puedes agregar fotos/i)).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /agregar foto/i }).click();
  await (await chooser).setFiles(resolve(here, 'fixtures/photo.png'));
  await expect(page.getByText(/1\/8/)).toBeVisible();

  await page.getByRole('button', { name: /enviar/i }).click();

  // --- kid: the invoice shows as waiting ---
  await page.goto('/kid/invoices');
  await expect(page.getByText(/esperando respuesta/i)).toBeVisible();

  // --- parent: the PIN gate is not set, so the parent view is reachable ---
  await page.goto('/inbox');
  await expect(page.getByRole('link', { name: /Mia/ })).toBeVisible();
  await page.getByRole('link', { name: /Mia/ }).click();
  // the kid's photo is readable by the parent
  await expect(page.locator('img').first()).toBeVisible();
  await page.getByRole('button', { name: /^aprobar$/i }).click();

  // --- kid: the pay stub, gross to net, and the balance ---
  await page.goto('/kid/invoices');
  await expect(page.getByText(/aprobada/i)).toBeVisible();
  const stub = page.getByTestId(/^paystub-/);
  await expect(stub).toContainText('5.000');   // gross, COP formatting
  await expect(stub).toContainText('4.000');   // net after 20% savings
  await page.goto('/kid');
  await expect(page.getByTestId('spendable')).toContainText('4.000');
  await expect(page.getByTestId('savings')).toContainText('1.000');

  // --- parent: pay it out ---
  await page.goto('/payouts');
  const payCard = page.getByRole('group', { name: /Mia/ });
  await payCard.getByLabel(/monto a pagar/i).fill('4000');
  await payCard.getByRole('button', { name: /registrar pago/i }).click();
  await expect(payCard.getByText(/pago/i).first()).toBeVisible();
  await page.goto('/kid');
  await expect(page.getByTestId('spendable')).toContainText('0');
});

test('a second kid on the same device cannot read the first kid’s cache', async ({ page }) => {
  // the whole reason Task 11 destroys the cache on identity change: real
  // IndexedDB, real reload, two kids, one browser profile
  await signUpParent(page);
  await page.getByLabel(/nombre de la familia/i).fill('Talero');
  await page.getByRole('button', { name: /crear familia/i }).click();

  const codes: string[] = [];
  for (const name of ['Mia', 'Sib']) {
    await page.getByRole('link', { name: /niños/i }).click();
    await page.getByLabel(/^nombre$/i).fill(name);
    await page.getByLabel(/año de nacimiento/i).fill('2016');
    await page.getByRole('button', { name: /agregar niño/i }).click();
    const card = page.getByRole('group', { name: new RegExp(name) });
    await card.getByRole('button', { name: /mostrar código/i }).click();
    codes.push((await card.getByTestId('join-code').textContent())!.trim());
  }

  // the ids the probe needs, read straight from the emulator
  const { familyId, firstKidId } = await ids();

  // kid one signs in and caches their own balance
  await page.goto('/kid');
  await page.getByLabel(/código/i).fill(codes[0]!);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page.getByRole('heading', { name: /Hola, Mia/ })).toBeVisible();

  // hand the device over: the switcher ends the session and clears the cache
  await page.getByRole('button', { name: /volver con un adulto/i }).click();
  await page.goto('/kid');
  await page.getByLabel(/código/i).fill(codes[1]!);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page.getByRole('heading', { name: /Hola, Sib/ })).toBeVisible();

  await page.reload();
  // the second kid is still signed in after a reload — this is what the
  // stable app name buys, and a generation-suffixed name would fail here
  await expect(page.getByRole('heading', { name: /Hola, Sib/ })).toBeVisible();
  await expect(page.getByText(/Hola, Mia/)).toHaveCount(0);

  // and the real question: can anything still READ the first kid's document?
  // Asserting on IndexedDB database NAMES cannot answer that — Firestore
  // names its store `firestore/<appName>/<project>/main`, so a name check is
  // both implementation-coupled and, for a stable app name, always true.
  // Probe the cache and the server instead, through the dev-only seam.
  const leaked = await page.evaluate(async (kidPath) =>
    (window as unknown as { __mk: { cachedRead(path: string): Promise<boolean> } })
      .__mk.cachedRead(kidPath), `families/${familyId}/kids/${firstKidId}`);
  expect(leaked, 'the first kid’s document was still served from cache').toBe(false);

  const denied = await page.evaluate(async (kidPath) =>
    (window as unknown as { __mk: { serverRead(path: string): Promise<string> } })
      .__mk.serverRead(kidPath), `families/${familyId}/kids/${firstKidId}`);
  // rules deny it too: cache isolation is the fix, not the only guard
  expect(denied).toMatch(/permission-denied/);
});

test('a draft written offline survives a reload and syncs', async ({ page, context }) => {
  await signUpParent(page);
  await page.getByLabel(/nombre de la familia/i).fill('Talero');
  await page.getByRole('button', { name: /crear familia/i }).click();
  await page.getByRole('link', { name: /niños/i }).click();
  await page.getByLabel(/^nombre$/i).fill('Mia');
  await page.getByLabel(/año de nacimiento/i).fill('2016');
  await page.getByRole('button', { name: /agregar niño/i }).click();
  const card = page.getByRole('group', { name: /Mia/ });
  await card.getByRole('button', { name: /mostrar código/i }).click();
  const code = (await card.getByTestId('join-code').textContent())!.trim();

  await page.goto('/kid');
  await page.getByLabel(/código/i).fill(code);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page.getByRole('heading', { name: /Hola, Mia/ })).toBeVisible();

  // real IndexedDB: this is the part jsdom cannot test
  await context.setOffline(true);
  await page.goto('/kid/new');
  await page.getByLabel(/qué hiciste/i).fill('Sin internet');
  await page.getByLabel(/cuánto/i).fill('3000');
  await page.getByRole('button', { name: /guardar/i }).click();

  await page.reload();
  await page.goto('/kid/invoices');
  await expect(page.getByText(/Sin internet/)).toBeVisible();

  await context.setOffline(false);
  await page.goto('/kid/invoices');
  await expect(page.getByText(/sin enviar/i)).toBeVisible();
});
```

`e2e/fixtures/photo.png` — a real PNG, so the browser's decoder and our canvas path both do real work:
```bash
magick -size 2000x1500 gradient:'#0b7285-#fdfbf7' e2e/fixtures/photo.png
# or: node -e "…" writing a minimal valid PNG; it must be genuinely decodable
```

- [ ] **Step 5: Run it**

Run: `npm run test:e2e`
Expected: both specs PASS.

Two failures to expect first, and what they mean rather than how to silence them:
- **A locator matching two elements** — the kid and parent shells can both be mounted in the same DOM if a navigation did not unmount. Scope the locator to a `group`/`main`, do not add `.first()` blindly.
- **The photo upload failing with `permission-denied`** — the draft had not reached the server yet. That is the real constraint from Task 11, not a test artefact: the Storage rule reads the invoice. Wait for the saved confirmation before attaching, as the spec above does.

- [ ] **Step 6: Commit**

```bash
git add app e2e package.json package-lock.json
git commit -m "test(e2e): mobile-viewport Playwright run of the whole invoice loop"
```

---

## Final gate

Run every suite plus both builds, as the last step of Task 13:
```bash
npm run typecheck
npm test -w @money-kids/shared
npm run test:rules
npm run test:functions
npm run test:app
npm run test:e2e
npm run build:app
npm run build -w @money-kids/functions
```
Expected: everything passes, no type errors in any workspace, both bundles build, the manifest and service worker are emitted.

## Deliberate gaps in this plan

Stated so a reviewer does not read them as oversights:

- **Photo *upload* is not covered by a component test**, though removal and the 5–8 send gate are. jsdom has no image encoder, so the compression arithmetic and its limits are unit-tested with the decode and encode seams stubbed, the removal test attaches a path the way a finished upload would, and the real upload runs only under Playwright.
- **That `clearIndexedDbPersistence` really erases the on-disk cache is Playwright-only.** jsdom has no IndexedDB, so the component test can only prove the kid instance is rebuilt and its cache is empty; Task 13 asserts a second kid on the same browser profile cannot read the first kid's documents after a reload.
- **Offline survival across a reload is Playwright-only.** jsdom has no IndexedDB, so the component suite runs on the memory cache and can prove queueing and sync but not persistence.
- **QR codes are not built.** Manual code entry was chosen deliberately (see Decisions); the parent screen already shows the code as text.
- **Voice notes for the 5–8 mode are out**, per the spec's own out-of-scope list, which is why that mode is photo-plus-tap rather than photo-plus-audio.
- **Savings goals are out**, per the spec: the savings *balance* ships, targets and progress do not.
- **Push notifications are out**, per the spec; the parent tab badge remains the only notification.
- **The kid cannot see who reviewed their invoice by name.** Events carry `actorUid`, and resolving it to a display name needs a members read that the kid rules do not grant. Showing a raw uid to a child would be worse than showing nothing.

## What comes after this plan

- **Deploy:** real Firebase project, `firebase deploy` for rules, indexes, functions and hosting, and a first family onboarded for real.
- **Fast-follows the spec already lists:** QR join codes, savings goals, voice notes for the youngest mode, push notifications, and micro-lessons.
