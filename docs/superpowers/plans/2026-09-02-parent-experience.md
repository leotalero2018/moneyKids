# Money Kids — Plan 2: Parent Experience

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete parent-facing PWA on top of Plan 1's money engine: sign-in and family creation, kid profiles and device join codes, additional-parent invites, the bilingual activity board, the invoice inbox with approve / counter-offer / return, payout recording, and deduction settings.

**Architecture:** A new `app/` npm workspace holds a React + Vite PWA. It talks to Firestore directly for reads and non-money writes (under Plan 1's security rules) and calls Plan 1's callable Cloud Functions for every money mutation. Data reaches components through two hand-written hooks (`useDoc`, `useCollection`) that wrap `onSnapshot`, so the UI is real-time and offline-capable with no data-layer dependency. Styling is design tokens in CSS custom properties plus CSS Modules — **the same system Plan 3's kid UI uses**, where age modes become token overrides rather than a second stylesheet.

**Tech Stack:** React 18, Vite 5, TypeScript (strict), react-router-dom 6, react-i18next, Vitest + React Testing Library + jsdom, `firebase` JS SDK v10, `qrcode` for join-code display. No CSS framework, no data-fetching library.

**Spec:** `docs/superpowers/specs/2026-07-31-money-kids-design.md`

**Predecessor:** `docs/superpowers/plans/2026-07-31-money-engine.md` (Plan 1, complete). **This plan assumes the `harden-rules-review` field-validation commit is merged into `main`** — Task 1 amends the whitelists it introduced, and Tasks 10–11 write documents that must satisfy them.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-money-kids-design.md`. Every invariant below is copied from it or from Plan 1's shipped code.
- **All money is integer minor units.** COP has 0 minor digits, USD has 2. Never use floating-point arithmetic on money; never call `toFixed` on a minor-unit value. Formatting and parsing go through `@money-kids/shared` helpers (Task 2) — nowhere else.
- **Family `currency` is immutable** (rule-enforced) and chosen once at family creation. The UI must present this as permanent.
- **Money mutations are callables only.** The client never writes `ledger`, never writes `kids.*.spendableBalance`/`savingsBalance`, and never transitions an invoice to `approved`. Approve → `approveInvoice`; kid accepting a counter → `acceptCounterOffer`; payout → `recordPayout`; deduction rules → `setDeductionRules`. A direct Firestore write for any of these is a bug, and the rules will reject it.
- **Client-side transitions are batched with their event.** `returned` and `countered` are parent-driven client writes; each must be a single `writeBatch` containing the invoice update (`status`, `eventCount: previous + 1`, plus `counterOffer` when countering) *and* the event document at the deterministic ID `e{newEventCount}`. Rules reject either write alone.
- **Event document shape** (rule-enforced, exactly these keys, no others): `{ from, to, actorUid, at, note?, requestedAmount?, kidId }`. `actorUid` must equal the caller's uid, `at` must be `serverTimestamp()`, `kidId` must equal the invoice's own `kidId`, `from` must equal the invoice's pre-batch status, `from != to`, `note` is optional and ≤ 500 chars, and `requestedAmount` appears **only** on `→ sent` events (kid-side, Plan 3).
- **Field bounds the rules enforce** (exceeding them fails the write): invoice `description` ≤ 1000; event and counter-offer `note` ≤ 500; activity `titleEs`/`titleEn` ≤ 80; activity `descriptionEs`/`descriptionEn` ≤ 500; activity `category` ∈ `learn | courage | ideas | help`; `photoPaths` ≤ 8 entries.
- **Family creation is a single batch** containing `families/{id}` *and* `families/{id}/members/{uid}` — the rules reject a family without its founder's member doc, because such a family is permanently unreachable.
- **Kid creation must set both balances to 0** — the rules reject any other value.
- **Queries must be rule-shaped.** Firestore rules do not filter results: a query the rules cannot authorize fails outright rather than returning a subset. Parents may query their whole family; kid sessions may only query constrained by their own `kidId`.
- **Bilingual from day one.** Every user-visible string comes from `react-i18next` with `es` and `en` resources. The starter activity catalog is authored in both languages. `es` is the default. No hardcoded copy in components — a test enforces this (Task 4).
- Node ≥ 20.11, TypeScript `strict: true`. Every workspace has a `typecheck` script (`tsc --noEmit`) and **every task's verification step runs it** — Vitest transpiles without typechecking, so `strict` is otherwise unenforced.
- Component tests run against the **Firebase emulators** via `firebase emulators:exec`, the same harness Plan 1 uses. Ports are in `firebase.json` (Firestore 8480, Auth 9099, Storage 9199).
- Commit after every task (steps say when).

---

## File Structure

**New workspace `app/`** — the PWA. One responsibility per file; screens hold layout and copy, `lib/` holds writes, `hooks/` holds reads.

| File | Responsibility |
|---|---|
| `app/src/firebase.ts` | Initialize the Firebase app; connect to emulators when `import.meta.env.VITE_USE_EMULATORS`; export `db`, `auth`, `fns` |
| `app/src/hooks/useDoc.ts` | `onSnapshot` on one document → `{ data, loading, error }` |
| `app/src/hooks/useCollection.ts` | `onSnapshot` on a query → `{ docs, loading, error }` |
| `app/src/session/SessionContext.tsx` | Auth user, resolved `familyId`, family doc, language; the gate every screen reads |
| `app/src/i18n/index.ts`, `es.json`, `en.json` | Translation resources and init |
| `app/src/styles/tokens.css` | Design tokens as CSS custom properties — **shared with Plan 3's kid UI**; age modes override these |
| `app/src/styles/global.css` | Reset, base type scale, safe-area insets |
| `app/src/components/*.tsx` + `*.module.css` | Primitives: `Button`, `Card`, `Money`, `Spinner`, `ErrorBanner`, `BottomTabs`, `PillarIcon` |
| `app/src/screens/SignIn.tsx` | Email/password + Google sign-in |
| `app/src/screens/CreateFamily.tsx` | Family name, language, currency (permanent) → one batch with the founder member doc |
| `app/src/screens/Kids.tsx` | Kid list, add kid, deductions toggle, join code (as text; QR is Plan 3), revoke access |
| `app/src/screens/Activities.tsx` | Activity board CRUD, starter-catalog seeding |
| `app/src/screens/Inbox.tsx` | Pending-invoice list with badge count |
| `app/src/screens/InvoiceDetail.tsx` | Photos, negotiation history, approve / counter / return |
| `app/src/screens/Payouts.tsx` | Per-kid balances, record payout, ledger history |
| `app/src/screens/Settings.tsx` | Deduction rules, parent invites, language, parent PIN |
| `app/src/screens/JoinParent.tsx` | Redeem a parent invite code |
| `app/src/lib/invoiceActions.ts` | `returnInvoice` / `counterInvoice` — the batched transition+event writes |
| `app/src/lib/callables.ts` | Typed wrappers over Plan 1's callables |
| `app/src/lib/catalog.ts` | The bilingual starter catalog (four pillars) |
| `app/src/lib/pin.ts` | Parent PIN storage and check (device-local UI lock) |

**Modified outside `app/`:**

| File | Change |
|---|---|
| `firestore.rules` | Task 1: `createdAt` on invoices; `createdBy` + `createdAt` on activities; `parentInvites` stays server-only |
| `packages/rules-tests/src/*.test.ts` | Task 1: coverage for the amended whitelists |
| `packages/shared/src/money.ts` | Task 2: `minorDigits`, `formatMinor`, `parseMajor` |
| `functions/src/parentInvites.ts` | Task 9: `createParentInviteCore`, `acceptParentInviteCore` |
| `functions/src/index.ts` | Task 9: export the two new callables |
| `package.json` | Task 3: `dev`, `build:app`, `test:app` scripts |

---

### Task 1: Rules amendments the parent UI requires

**Why this exists:** two spec requirements are currently unimplementable. The invoice document has **no timestamp field** and the create whitelist forbids adding one, so the parent inbox cannot be ordered by when invoices arrived (Firestore auto-IDs are not time-ordered). And activities have **no `createdBy`**, so the spec's "every approval, counter-offer, payout, and activity records the acting parent's ID, shown in the UI" cannot be satisfied for activities. Both are one-line whitelist extensions, but they are rule changes and so belong in their own reviewed task ahead of any UI.

**Files:**
- Modify: `firestore.rules`
- Test: `packages/rules-tests/src/invoices.test.ts`

**Interfaces:**
- Produces: `invoices.createdAt` (server timestamp, set at draft creation, immutable) and `activities.createdBy` / `activities.createdAt`, relied on by Tasks 10 and 11.

- [ ] **Step 1: Write the failing tests**

Add to `packages/rules-tests/src/invoices.test.ts`, inside `describe('invoice lifecycle', ...)`:

```ts
  it('draft creation stamps an immutable server-set createdAt', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    // the inbox orders by this field, so it must exist and be server-derived
    await assertSucceeds(setDoc(doc(kdb, 'families/fam1/invoices/inv1'),
      { ...draft, createdAt: serverTimestamp() }));
    // a client-chosen time is rejected — ordering must not be forgeable
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv2'),
      { ...draft, createdAt: new Date(2000, 0, 1) }));
    // and it cannot be rewritten later
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'),
      { createdAt: serverTimestamp() }));
  });
```

And inside `describe('activities', ...)`:

```ts
  it('activities record the acting parent and creation time', async () => {
    const pdb = parentCtx(env, 'p1').firestore();
    const valid = {
      titleEs: 'Valentía', titleEn: 'Courage', descriptionEs: '', descriptionEn: '',
      suggestedPrice: 3000, category: 'courage', repeatable: false, active: true,
      createdBy: 'p1', createdAt: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(pdb, 'families/fam1/activities/act2'), valid));
    // createdBy is the acting parent, not a claim
    await assertFails(setDoc(doc(pdb, 'families/fam1/activities/act3'),
      { ...valid, createdBy: 'someone-else' }));
    await assertFails(setDoc(doc(pdb, 'families/fam1/activities/act4'),
      { ...valid, createdAt: new Date(2000, 0, 1) }));
    // an edit may change the activity but never its attribution
    await assertSucceeds(updateDoc(doc(pdb, 'families/fam1/activities/act2'), { active: false }));
    await assertFails(updateDoc(doc(pdb, 'families/fam1/activities/act2'), { createdBy: 'p2' }));
    await assertFails(updateDoc(doc(pdb, 'families/fam1/activities/act2'),
      { createdAt: serverTimestamp() }));
  });
```

The seed in `beforeEach` creates `act1` without these fields; update it so it stays representative:

```ts
    await setDoc(doc(db, 'families/fam1/activities/act1'), {
      titleEs: 'Lee un libro', titleEn: 'Read a book', descriptionEs: '', descriptionEn: '',
      suggestedPrice: 5000, category: 'learn', repeatable: true, active: true,
      createdBy: 'p1', createdAt: serverTimestamp(),
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — the new fields are outside both whitelists, so even the success cases are denied. (Note the existing "activity writes are field-whitelisted" test also fails now, because its `valid` object omits the two new required keys; add `createdBy: 'p1', createdAt: serverTimestamp()` to that object too, and leave its negative cases alone.)

- [ ] **Step 3: Amend the rules**

In the `invoices` match block, extend both key lists and add the two checks:

```
        allow create: if isFamilyKid()
          && newInv().keys().hasOnly(['kidId', 'activityId', 'description', 'photoPaths', 'status', 'requestedAmount', 'eventCount', 'createdAt'])
          && newInv().keys().hasAll(['kidId', 'activityId', 'description', 'photoPaths', 'status', 'requestedAmount', 'eventCount', 'createdAt'])
          && newInv().kidId == authKidId()
          && newInv().status == 'draft'
          && newInv().eventCount is int && newInv().eventCount == 0
          && newInv().requestedAmount is int && newInv().requestedAmount > 0
          && descriptionOk()
          && (newInv().activityId == null || newInv().activityId is string)
          // server-derived: the inbox orders by this, so a client must not choose it
          && newInv().createdAt == request.time
          && photosWithinCap();
```

`createdAt` is absent from every `affectedKeys().hasOnly([...])` list on the update rules, so it is already immutable after creation — no further change is needed for that, and the test above proves it.

In the `activities` match block, **split `create` from `update`**. Sharing one clause looks tidier but forces `createdAt == request.time` on edits too, which makes attribution mean "last edited by" instead of "created by" — and rewritable attribution is not attribution:

```
        function actShapeOk() {
          return act().keys().hasOnly(['titleEs', 'titleEn', 'descriptionEs', 'descriptionEn',
                                       'suggestedPrice', 'category', 'repeatable', 'active',
                                       'createdBy', 'createdAt'])
            && act().keys().hasAll(['titleEs', 'titleEn', 'descriptionEs', 'descriptionEn',
                                    'suggestedPrice', 'category', 'repeatable', 'active',
                                    'createdBy', 'createdAt'])
            && act().suggestedPrice is int
            && act().suggestedPrice >= 0
            && boundedText(act().titleEs, 80) && boundedText(act().titleEn, 80)
            && boundedText(act().descriptionEs, 500) && boundedText(act().descriptionEn, 500)
            && act().category in ['learn', 'courage', 'ideas', 'help']
            && act().repeatable is bool
            && act().active is bool;
        }
        // the spec requires every activity to record the acting parent
        allow create: if isFamilyParent() && actShapeOk()
          && act().createdBy == request.auth.uid
          && act().createdAt == request.time;
        // attribution is immutable: an edit may change the activity but never
        // who created it or when, so a later editor cannot claim authorship
        allow update: if isFamilyParent() && actShapeOk()
          && act().createdBy == resource.data.createdBy
          && act().createdAt == resource.data.createdAt;
```

Consequence for Task 10: a partial `updateDoc({ active: false })` **works** — `request.resource.data` on an update is the resulting document, so `hasAll` is satisfied by the merge and the unchanged attribution passes its equality checks. Task 10's edit path is therefore an ordinary partial update, not a full resend.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:rules && npm run typecheck`
Expected: all rules tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules packages/rules-tests
git commit -m "feat(rules): timestamp invoices and attribute activities to the acting parent"
```

---

### Task 2: Money formatting and parsing in `@money-kids/shared`

**Why this exists:** every screen displays money and two screens accept money input. Minor units mean the conversion depends on the currency (COP has 0 minor digits, USD has 2), so a single wrong divisor is a 100× money bug. This is pure logic, so it is unit-tested in `shared` rather than discovered through the UI.

**Files:**
- Modify: `packages/shared/src/money.ts`
- Test: `packages/shared/src/money.test.ts`

**Interfaces:**
- Produces:
  - `minorDigits(currency: string): number` — 0 for COP/JPY, 2 for USD/EUR; throws on an unknown/malformed code
  - `formatMinor(minor: number, currency: string, locale: string): string` — localized currency string; throws on non-integer input
  - `parseMajor(input: string, currency: string): number` — user-typed major-unit text → integer minor units; throws `Error` on anything not a clean non-negative amount with at most `minorDigits` decimals

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/money.test.ts`:

```ts
import { minorDigits, formatMinor, parseMajor } from './money.js';

describe('minorDigits', () => {
  it('knows the zero-decimal and two-decimal currencies the app ships with', () => {
    expect(minorDigits('COP')).toBe(0);
    expect(minorDigits('USD')).toBe(2);
    expect(minorDigits('EUR')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
  });
  it('rejects malformed codes rather than guessing', () => {
    expect(() => minorDigits('')).toThrow(/currency/i);
    expect(() => minorDigits('usd')).toThrow(/currency/i);
    expect(() => minorDigits('DOLLARS')).toThrow(/currency/i);
  });
});

describe('formatMinor', () => {
  // Assert on digits, not on symbols or spacing: ICU output varies by
  // Node version, and a test pinned to '$1,234.00' will fail on an upgrade
  // for no real reason.
  it('scales by the currency, not by a fixed 100', () => {
    expect(formatMinor(1234, 'COP', 'es-CO')).toMatch(/1[.,\s]?234/);
    expect(formatMinor(1234, 'COP', 'es-CO')).not.toMatch(/12[.,]34/);
    expect(formatMinor(1234, 'USD', 'en-US')).toMatch(/12[.,]34/);
  });
  it('formats zero and rejects non-integers', () => {
    expect(formatMinor(0, 'USD', 'en-US')).toMatch(/0/);
    expect(() => formatMinor(12.5, 'USD', 'en-US')).toThrow(/integer/i);
  });
});

describe('parseMajor', () => {
  // Contract: a zero-decimal currency cannot have a decimal mark, so every
  // separator in it is grouping and is stripped. A two-decimal currency
  // accepts exactly one separator followed by 1-2 digits and nothing else —
  // '1,234' is REJECTED rather than guessed at, because grouping and decimal
  // marks are ambiguous across locales and this is money. The input screens
  // strip grouping before calling (Task 11 and Task 12).
  it('converts major-unit input to minor units per currency', () => {
    expect(parseMajor('1234', 'COP')).toBe(1234);
    expect(parseMajor('12.34', 'USD')).toBe(1234);
    expect(parseMajor('12,34', 'USD')).toBe(1234); // es-CO types the decimal as ','
    expect(parseMajor('12.3', 'USD')).toBe(1230);
    expect(parseMajor('12', 'USD')).toBe(1200);
    expect(parseMajor('0', 'USD')).toBe(0);
  });
  it('strips grouping in zero-decimal currencies, where it cannot be a decimal', () => {
    expect(parseMajor('  1.234  ', 'COP')).toBe(1234); // es-CO groups with '.'
    expect(parseMajor('1,234,567', 'COP')).toBe(1234567);
  });
  it('rejects a decimal mark a zero-decimal currency cannot have', () => {
    expect(() => parseMajor('12.5', 'COP')).toThrow(/decimal/i);
  });
  it('rejects more decimals than the currency has, and ambiguous grouping', () => {
    expect(() => parseMajor('12.345', 'USD')).toThrow(/decimal/i);
    expect(() => parseMajor('1,234', 'USD')).toThrow(/decimal/i);
  });
  it('rejects negatives, blanks, and non-numeric text', () => {
    expect(() => parseMajor('-5', 'USD')).toThrow(/amount/i);
    expect(() => parseMajor('', 'USD')).toThrow(/amount/i);
    expect(() => parseMajor('abc', 'USD')).toThrow(/amount/i);
    expect(() => parseMajor('1e3', 'USD')).toThrow(/amount/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @money-kids/shared`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement**

Append to `packages/shared/src/money.ts`:

```ts
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function minorDigits(currency: string): number {
  if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
    throw new Error('currency must be a three-letter uppercase ISO 4217 code');
  }
  let digits: number | undefined;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency })
      .resolvedOptions().maximumFractionDigits;
  } catch {
    throw new Error(`currency ${currency} is not a known ISO 4217 code`);
  }
  if (digits === undefined) throw new Error(`currency ${currency} has no known minor unit`);
  return digits;
}

export function formatMinor(minor: number, currency: string, locale: string): string {
  if (!Number.isInteger(minor)) throw new Error('amount must be an integer in minor units');
  const digits = minorDigits(currency);
  // integer division keeps the scaling exact; the fraction is handed to Intl
  // as a number only after the divisor is known to be a power of ten
  const major = minor / 10 ** digits;
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency,
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(major);
}

export function parseMajor(input: string, currency: string): number {
  const digits = minorDigits(currency);
  if (typeof input !== 'string') throw new Error('amount must be text');
  const trimmed = input.replace(/\s/g, '');
  if (trimmed === '') throw new Error('amount is required');

  if (digits === 0) {
    // no decimal mark is possible, so every separator is grouping
    const whole = trimmed.replace(/[.,]/g, '');
    if (!/^\d+$/.test(whole)) throw new Error('amount must be a non-negative number');
    // ...but a lone separator followed by 1-2 digits is someone typing cents
    // into a currency that has none, which must not silently become 100x
    if (/[.,]\d{1,2}$/.test(trimmed)) {
      throw new Error(`${currency} has no decimal places`);
    }
    return Number(whole);
  }

  // exactly one separator, 1..digits fraction digits, nothing else. Grouping
  // is NOT accepted here: '1,234' is ambiguous between 1234 and 1.234, and
  // guessing wrong is a 1000x money error. Callers strip grouping first.
  const match = /^(\d+)(?:[.,](\d{1,}))?$/.exec(trimmed);
  if (!match) throw new Error('amount must be a non-negative number');
  const [, whole, frac = ''] = match;
  if (frac.length > digits) {
    throw new Error(`amount has more decimal places than ${currency} allows`);
  }
  return Number(whole) * 10 ** digits + Number(frac.padEnd(digits, '0') || 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @money-kids/shared && npm run typecheck -w @money-kids/shared`
Expected: all PASS; typecheck clean.

If the separator cases disagree with the tests, the heuristic is what to fix — do not relax the tests. The contract they encode: **0-decimal currency** → every separator is grouping and is stripped, except a trailing `[.,]\d{1,2}`, which is someone typing cents that do not exist and must fail loudly rather than become a 100× error. **2-decimal currency** → exactly one separator with 1–2 fraction digits, no grouping; `'1,234'` throws, because guessing between 1234 and 1.234 is a 1000× money error and the input screens strip grouping before calling.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): currency-aware money formatting and parsing"
```

---

### Task 3: App workspace scaffold, design tokens, and test harness

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/vite.config.ts`, `app/vitest.config.ts`, `app/index.html`, `app/src/main.tsx`, `app/src/App.tsx`, `app/src/App.test.tsx`, `app/src/styles/tokens.css`, `app/src/styles/global.css`, `app/src/test/setup.ts`
- Modify: root `package.json` (workspace scripts)

**Interfaces:**
- Produces: workspace `@money-kids/app`; `npm run dev` serves it; `npm run test:app` runs component tests; the token names in `tokens.css`, which **Plan 3's kid UI and age modes override rather than replace**.

- [ ] **Step 1: Create the workspace files**

`app/package.json`:
```json
{
  "name": "@money-kids/app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@money-kids/shared": "*",
    "firebase": "^10.12.0",
    "i18next": "^23.11.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-i18next": "^14.1.0",
    "react-router-dom": "^6.23.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

`app/tsconfig.json` — the app targets the DOM and uses `jsx`, so it cannot simply inherit the Node base:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
    "noEmit": true,
    "declaration": false
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

`app/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], server: { port: 5173 } });
```

`app/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // emulator-backed tests share one Firestore instance
    fileParallelism: false,
    testTimeout: 20000,
  },
});
```

`app/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`app/index.html`:
```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Money Kids</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the design tokens**

`app/src/styles/tokens.css` — **every visual value in the app comes from here.** Plan 3's age modes re-declare these under a `[data-age-mode]` selector; components never hardcode a color or size.
```css
:root {
  /* palette — warm and playful, but readable for a parent doing admin */
  --c-bg: #fdfbf7;
  --c-surface: #ffffff;
  --c-ink: #1f2933;
  --c-ink-soft: #52606d;
  --c-line: #e4e7eb;
  --c-accent: #0b7285;        /* actions */
  --c-accent-ink: #ffffff;
  --c-money: #0b7285;
  --c-warn: #a15c07;
  --c-danger: #a4262c;
  --c-learn: #3b6ea5;
  --c-courage: #a15c07;
  --c-ideas: #6b4d9b;
  --c-help: #2f7d55;

  /* type — the 8-12 mode baseline; other modes scale these */
  --f-body: 1rem;
  --f-small: 0.8125rem;
  --f-title: 1.375rem;
  --f-money: 1.75rem;
  --f-stack: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;

  /* space and shape */
  --s-1: 0.25rem;
  --s-2: 0.5rem;
  --s-3: 0.75rem;
  --s-4: 1rem;
  --s-5: 1.5rem;
  --s-6: 2rem;
  --radius: 0.75rem;
  --tap: 2.75rem;             /* minimum touch target; 5-8 mode raises it */
  --shadow: 0 1px 3px rgb(31 41 51 / 12%);
}
```

`app/src/styles/global.css`:
```css
@import './tokens.css';

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font: var(--f-body) / 1.5 var(--f-stack);
  color: var(--c-ink);
  background: var(--c-bg);
  /* the bottom tab bar sits above the home indicator */
  padding-bottom: env(safe-area-inset-bottom);
}

button, input, select, textarea { font: inherit; }
button { min-height: var(--tap); cursor: pointer; }
h1, h2, h3 { margin: 0 0 var(--s-3); line-height: 1.25; }
h1 { font-size: var(--f-title); }
```

- [ ] **Step 3: Write the failing smoke test**

`app/src/App.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App.js';

describe('app shell', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm install && npm run test:app`
Expected: FAIL — `App.js` does not exist.

- [ ] **Step 5: Implement the shell**

`app/src/App.tsx`:
```tsx
export function App() {
  return <main>Money Kids</main>;
}
```

`app/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Add `"app"` to the root `package.json` **`workspaces` array** — it currently lists only `["packages/*", "functions"]`, and without this every `-w @money-kids/app` command fails with "No workspaces found". Then add the scripts:
```json
    "dev": "npm run dev -w @money-kids/app",
    "build:app": "npm run build -w @money-kids/app",
    "test:app": "firebase emulators:exec --only firestore,auth --project money-kids-test \"npm test -w @money-kids/app\""
```

`test:app` runs under the emulators from the start: Task 5 onward, most component tests need them, and one command that always works beats two that differ.

- [ ] **Step 6: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: 1 test PASSES; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add app package.json package-lock.json
git commit -m "chore(app): scaffold React PWA workspace with design tokens"
```

---

### Task 4: i18n foundation (ES/EN)

**Files:**
- Create: `app/src/i18n/index.ts`, `app/src/i18n/es.json`, `app/src/i18n/en.json`, `app/src/i18n/i18n.test.ts`
- Modify: `app/src/main.tsx`, `app/src/App.tsx`, `app/src/App.test.tsx`

**Interfaces:**
- Produces: `initI18n(language: 'es' | 'en')`, the `useTranslation()` hook available app-wide, and the invariant that **`es.json` and `en.json` always have identical key sets** — enforced by a test, because a missing key silently renders the raw key string to a user.

- [ ] **Step 1: Write the failing tests**

`app/src/i18n/i18n.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import es from './es.json' with { type: 'json' };
import en from './en.json' with { type: 'json' };

function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? flatKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`]);
}

describe('translation resources', () => {
  it('has identical key sets in both languages', () => {
    // a key present in only one language renders as the raw key to that user
    const esKeys = flatKeys(es).sort();
    const enKeys = flatKeys(en).sort();
    expect(esKeys).toEqual(enKeys);
  });
  it('has no empty strings', () => {
    for (const resource of [es, en]) {
      for (const key of flatKeys(resource)) {
        const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], resource);
        expect(value, key).not.toBe('');
      }
    }
  });
  it('ships Spanish as the default language', async () => {
    const { initI18n } = await import('./index.js');
    const i18n = await initI18n('es');
    expect(i18n.t('nav.inbox')).toBe('Facturas');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:app`
Expected: FAIL — the i18n module and JSON files do not exist.

- [ ] **Step 3: Implement**

`app/src/i18n/es.json` — the starting key set (later tasks add their own keys to **both** files):
```json
{
  "nav": { "inbox": "Facturas", "activities": "Actividades", "kids": "Niños", "payouts": "Pagos", "settings": "Ajustes" },
  "common": {
    "save": "Guardar", "cancel": "Cancelar", "loading": "Cargando…",
    "error": "Algo salió mal", "retry": "Reintentar", "close": "Cerrar",
    "of": "de"
  },
  "money": { "spendable": "Disponible", "savings": "Ahorro" }
}
```

`app/src/i18n/en.json`:
```json
{
  "nav": { "inbox": "Invoices", "activities": "Activities", "kids": "Kids", "payouts": "Payouts", "settings": "Settings" },
  "common": {
    "save": "Save", "cancel": "Cancel", "loading": "Loading…",
    "error": "Something went wrong", "retry": "Retry", "close": "Close",
    "of": "of"
  },
  "money": { "spendable": "Spendable", "savings": "Savings" }
}
```

`app/src/i18n/index.ts`:
```ts
import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './es.json' with { type: 'json' };
import en from './en.json' with { type: 'json' };

export type Language = 'es' | 'en';

export async function initI18n(language: Language): Promise<i18n> {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      resources: { es: { translation: es }, en: { translation: en } },
      lng: language,
      fallbackLng: 'es',
      interpolation: { escapeValue: false },
      // a missing key must be loud in development, never silently blank
      returnEmptyString: false,
    });
  } else if (i18next.language !== language) {
    await i18next.changeLanguage(language);
  }
  return i18next;
}
```

Wire it in `app/src/main.tsx`, before render:
```tsx
import { initI18n } from './i18n/index.js';

await initI18n('es');
```

And make `App.tsx` use a translated string so the wiring is exercised:
```tsx
import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();
  return <main>{t('nav.inbox')}</main>;
}
```

`App.test.tsx` must now initialize i18n before rendering:
```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { initI18n } from './i18n/index.js';
import { App } from './App.js';

describe('app shell', () => {
  beforeAll(async () => { await initI18n('es'); });
  it('renders translated copy, not raw keys', () => {
    render(<App />);
    expect(screen.getByRole('main')).toHaveTextContent('Facturas');
  });
});
```

- [ ] **Step 4: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS; typecheck clean. If the JSON import assertion syntax (`with { type: 'json' }`) is unsupported by the installed TypeScript, use `resolveJsonModule: true` in `app/tsconfig.json` and plain `import es from './es.json'` instead — but keep the key-parity test either way.

- [ ] **Step 5: Commit**

```bash
git add app
git commit -m "feat(app): bilingual i18n foundation with enforced key parity"
```

---

### Task 5: Firebase client and the two read hooks

**Files:**
- Create: `app/src/firebase.ts`, `app/src/hooks/useDoc.ts`, `app/src/hooks/useCollection.ts`, `app/src/hooks/hooks.test.tsx`, `app/src/test/emulator.ts`
- Create: `app/.env`

**Interfaces:**
- Produces:
  - `db`, `auth`, `fns` from `firebase.ts` (emulator-connected when `VITE_USE_EMULATORS` is set)
  - `useDoc<T>(path: string | null): { data: T | null; loading: boolean; error: Error | null }` — `null` path means "not ready yet", and the hook stays in `loading: false, data: null` rather than subscribing
  - `useCollection<T>(query: Query | null): { docs: Array<T & { id: string }>; loading: boolean; error: Error | null }`
  - `signInTestParent(uid: string)` and `seedAsAdmin(fn)` from `test/emulator.ts`, used by every later component test

- [ ] **Step 1: Write the failing tests**

`app/src/hooks/hooks.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { collection, doc, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { useDoc } from './useDoc.js';
import { useCollection } from './useCollection.js';
import { signInTestParent, clearFirestoreData } from '../test/emulator.js';

beforeAll(async () => { await signInTestParent('p1'); });

beforeEach(async () => {
  await clearFirestoreData();
  // the real uid, never the literal 'p1' — and family + founder member doc
  // MUST be one batch, or the founder-membership rule rejects the family
  const uid = auth.currentUser!.uid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'families/fam1'), {
    name: 'Talero', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(db, 'families/fam1/members', uid), { role: 'parent', displayName: 'Leo' });
  await batch.commit();
  await setDoc(doc(db, 'families/fam1/kids/k1'), {
    name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
  });
});

describe('useDoc', () => {
  it('loads a document and then reflects live updates', async () => {
    const { result } = renderHook(() => useDoc<{ name: string }>('families/fam1'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data?.name).toBe('Talero'));
    await setDoc(doc(db, 'families/fam1'), {
      name: 'Talero-Ruiz', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [],
    });
    // the point of onSnapshot: no refetch call anywhere in the component
    await waitFor(() => expect(result.current.data?.name).toBe('Talero-Ruiz'));
  });

  it('does not subscribe when the path is null', () => {
    const { result } = renderHook(() => useDoc('families/fam1'));
    const { result: idle } = renderHook(() => useDoc(null));
    expect(idle.current.loading).toBe(false);
    expect(idle.current.data).toBeNull();
    expect(result.current.loading).toBe(true); // the positive case still subscribes
  });

  it('surfaces a permission error instead of hanging in loading', async () => {
    const { result } = renderHook(() => useDoc('families/nope/kids/k1'));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.loading).toBe(false);
  });
});

describe('useCollection', () => {
  it('loads matching documents with their ids', async () => {
    const q = query(collection(db, 'families/fam1/kids'), where('birthYear', '==', 2016));
    const { result } = renderHook(() => useCollection<{ name: string }>(q));
    await waitFor(() => expect(result.current.docs).toHaveLength(1));
    expect(result.current.docs[0]).toMatchObject({ id: 'k1', name: 'Mia' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:app`
Expected: FAIL — `firebase.js`, the hooks, and the test helper do not exist.

- [ ] **Step 3: Implement**

`app/.env` — **not** `.env.development`: Vitest runs in `test` mode and would never load a `.development` file, so the app would initialize with no API key and fail with `auth/invalid-api-key`.
```
VITE_USE_EMULATORS=1
VITE_FB_PROJECT_ID=money-kids-test
VITE_FB_API_KEY=demo-key
VITE_FB_AUTH_DOMAIN=localhost
VITE_FB_STORAGE_BUCKET=money-kids-test.appspot.com
```

`app/src/firebase.ts`:
```ts
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const fns = getFunctions(app);

if (import.meta.env.VITE_USE_EMULATORS) {
  // ports mirror firebase.json; Firestore is on 8480, not the default 8080
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8480);
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);
}
```

`app/src/hooks/useDoc.ts`:
```ts
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';

export interface DocState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/** Live single-document read. A null path means "not ready" — no subscription. */
export function useDoc<T>(path: string | null): DocState<T> {
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
        loading: false,
        error: null,
      }),
      // a denied read must surface, not leave the screen spinning forever
      (error) => setState({ data: null, loading: false, error }),
    );
    return unsub;
  }, [path]);

  return state;
}
```

`app/src/hooks/useCollection.ts`:
```ts
import { useEffect, useMemo, useState } from 'react';
import { onSnapshot, queryEqual, type Query } from 'firebase/firestore';

export interface CollectionState<T> {
  docs: Array<T & { id: string }>;
  loading: boolean;
  error: Error | null;
}

/**
 * Live query read. Callers build the Query inline, so the identity changes on
 * every render — `queryEqual` is what stops that from resubscribing forever.
 */
export function useCollection<T>(q: Query | null): CollectionState<T> {
  const [state, setState] = useState<CollectionState<T>>({
    docs: [], loading: q !== null, error: null,
  });
  const [stable, setStable] = useState<Query | null>(q);
  if (q === null ? stable !== null : stable === null || !queryEqual(q, stable)) {
    setStable(q);
  }

  useEffect(() => {
    if (stable === null) {
      setState({ docs: [], loading: false, error: null });
      return;
    }
    setState({ docs: [], loading: true, error: null });
    const unsub = onSnapshot(
      stable,
      (snap) => setState({
        docs: snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T & { id: string }),
        loading: false,
        error: null,
      }),
      (error) => setState({ docs: [], loading: false, error }),
    );
    return unsub;
  }, [stable]);

  return useMemo(() => state, [state]);
}
```

`app/src/test/emulator.ts` — shared by every later component test:
```ts
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase.js';

const PROJECT_ID = import.meta.env.VITE_FB_PROJECT_ID;

/** Signs in as a parent with a stable uid-like email, creating them on first use. */
export async function signInTestParent(uid: string): Promise<void> {
  const email = `${uid}@example.test`;
  const password = 'test-password';
  try {
    await createUserWithEmailAndPassword(auth, email, password);
  } catch {
    await signInWithEmailAndPassword(auth, email, password);
  }
}

/** Wipes Firestore between tests through the emulator's REST endpoint. */
export async function clearFirestoreData(): Promise<void> {
  await fetch(
    `http://127.0.0.1:8480/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
}
```

**Note for the implementer:** `signInTestParent('p1')` produces a Firebase uid that is *not* the string `p1` — it is whatever the Auth emulator assigns. Every test that seeds a `members/{uid}` doc must therefore use `auth.currentUser!.uid`, not the literal. Write the seeds that way from the start; a literal `'p1'` member doc will make every parent read fail the membership check.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS. If `useCollection` resubscribes endlessly (visible as a test timeout), the `queryEqual` guard is wrong — that guard is the whole reason the hook takes a `Query` rather than a path.

- [ ] **Step 5: Commit**

```bash
git add app
git commit -m "feat(app): firebase client and live read hooks"
```

---

### Task 6: Session context and sign-in

**Files:**
- Create: `app/src/session/SessionContext.tsx`, `app/src/session/SessionContext.test.tsx`, `app/src/screens/SignIn.tsx`, `app/src/screens/SignIn.module.css`, `app/src/screens/SignIn.test.tsx`, `app/src/components/Button.tsx`, `app/src/components/Button.module.css`, `app/src/components/Spinner.tsx`, `app/src/components/ErrorBanner.tsx`, `app/src/components/ErrorBanner.module.css`
- Modify: `app/src/i18n/es.json`, `app/src/i18n/en.json`

**Interfaces:**
- Consumes: `useDoc`, `useCollection`, `auth`, `db` (Task 5).
- Produces:
  - `<SessionProvider>` and `useSession(): Session`, where
    `Session = { user: User | null; familyId: string | null; family: Family | null; role: 'parent' | null; status: 'loading' | 'signed-out' | 'no-family' | 'ready' }`
  - `interface Family { id: string; name: string; language: Language; currency: string; createdBy: string; deductionRules: DeductionRule[] }`
  - `<SignIn />`, `<Button>`, `<Spinner>`, `<ErrorBanner>` used by every later screen

**How the family is resolved:** a parent's `familyId` is not on their auth token — membership lives in `families/{familyId}/members/{uid}`. A collection-group query over `members` filtered by document id is not expressible, so the session reads `parentIndex/{uid}` — a tiny pointer document written at family creation (Task 7) and at invite acceptance (Task 9), holding `{ familyId }`. Rules for it:

```
    match /parentIndex/{uid} {
      // a parent's own pointer to their family; readable and creatable only by them
      allow get: if request.auth != null && request.auth.uid == uid;
      allow create: if request.auth != null && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['familyId'])
        && request.resource.data.familyId is string
        && existsAfter(/databases/$(database)/documents/families/$(request.resource.data.familyId)/members/$(uid));
      allow update, delete: if false;
    }
```
The `existsAfter` requirement means a parent cannot point themselves at a family they are not a member of — the pointer and the member doc must be created in the same batch. Add this block to `firestore.rules` in this task, above the catch-all deny, with the tests below.

- [ ] **Step 1: Write the failing rules test**

Add `packages/rules-tests/src/parentIndex.test.ts`:
```ts
import { describe, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { setupTestEnv, parentCtx, seed } from './helpers.js';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'families/fam1'), {
      name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [],
    });
    await setDoc(doc(db, 'families/fam1/members/p1'), { role: 'parent', displayName: 'Leo' });
  });
});

describe('parentIndex', () => {
  it('a parent creates their own pointer alongside their member doc', async () => {
    const db = parentCtx(env, 'p9').firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'families/fam9'), {
      name: 'New', language: 'en', currency: 'USD', createdBy: 'p9', deductionRules: [],
    });
    batch.set(doc(db, 'families/fam9/members/p9'), { role: 'parent', displayName: 'P9' });
    batch.set(doc(db, 'parentIndex/p9'), { familyId: 'fam9' });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(db, 'parentIndex/p9')));
  });
  it('cannot point at a family you are not a member of', async () => {
    const db = parentCtx(env, 'intruder').firestore();
    await assertFails(setDoc(doc(db, 'parentIndex/intruder'), { familyId: 'fam1' }));
  });
  it('cannot write or read someone else\'s pointer', async () => {
    const db = parentCtx(env, 'p9').firestore();
    await assertFails(setDoc(doc(db, 'parentIndex/p1'), { familyId: 'fam1' }));
    await assertFails(getDoc(doc(db, 'parentIndex/p1')));
  });
  it('is immutable once written', async () => {
    const db = parentCtx(env, 'p1').firestore();
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'parentIndex/p1'), { familyId: 'fam1' });
    });
    await assertFails(setDoc(doc(db, 'parentIndex/p1'), { familyId: 'fam2' }));
  });
});
```

- [ ] **Step 2: Run it, add the rules block, run again**

Run: `npm run test:rules` → FAIL (denied by the catch-all).
Add the `parentIndex` block shown above to `firestore.rules`.
Run: `npm run test:rules` → PASS.

- [ ] **Step 3: Write the failing session and sign-in tests**

`app/src/session/SessionContext.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from '../firebase.js';
import { SessionProvider, useSession } from './SessionContext.js';
import { initI18n } from '../i18n/index.js';
import { signInTestParent, clearFirestoreData } from '../test/emulator.js';

function Probe() {
  const s = useSession();
  return <div data-testid="status">{s.status}:{s.family?.name ?? '-'}</div>;
}

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); });

describe('SessionProvider', () => {
  it('reports signed-out with no user', async () => {
    await signOut(auth);
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
  });

  it('reports no-family for a signed-in parent without a pointer', async () => {
    await signInTestParent('nofamily');
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-family'));
  });

  it('resolves the family through parentIndex and reports ready', async () => {
    await signInTestParent('hasfamily');
    const uid = auth.currentUser!.uid;
    const batch = writeBatch(db);
    batch.set(doc(db, 'families/famA'), {
      name: 'Talero', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
    });
    batch.set(doc(db, 'families/famA/members', uid), { role: 'parent', displayName: 'Leo' });
    batch.set(doc(db, 'parentIndex', uid), { familyId: 'famA' });
    await batch.commit();

    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready:Talero'));
  });
});
```

`app/src/screens/SignIn.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { SignIn } from './SignIn.js';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await signOut(auth); });

describe('SignIn', () => {
  // each test owns its own email: nothing here may depend on another test
  // having run first, or on the order vitest happens to pick
  it('creates an account and signs in', async () => {
    const email = `new-${crypto.randomUUID()}@example.test`;
    render(<SignIn />);
    await userEvent.type(screen.getByLabelText(/correo/i), email);
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'test-password');
    await userEvent.click(screen.getByRole('button', { name: /crear cuenta/i }));
    await waitFor(() => expect(auth.currentUser).not.toBeNull());
  });

  it('shows an error for a wrong password instead of failing silently', async () => {
    const email = `wrong-${crypto.randomUUID()}@example.test`;
    // create the account, then sign out, so the failure is specifically the
    // password and not a missing account
    await createUserWithEmailAndPassword(auth, email, 'test-password');
    await signOut(auth);

    render(<SignIn />);
    await userEvent.type(screen.getByLabelText(/correo/i), email);
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(auth.currentUser).toBeNull();
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npm run test:app`
Expected: FAIL — the session module and screen do not exist.

- [ ] **Step 5: Implement the primitives**

`app/src/components/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'danger';

export function Button(
  { variant = 'primary', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant },
) {
  return <button className={`${styles.button} ${styles[variant]}`} {...rest} />;
}
```

`app/src/components/Button.module.css`:
```css
.button {
  border: 1px solid transparent;
  border-radius: var(--radius);
  padding: var(--s-2) var(--s-4);
  min-height: var(--tap);
  font-weight: 600;
}
.button:disabled { opacity: 0.5; cursor: default; }
.primary { background: var(--c-accent); color: var(--c-accent-ink); }
.secondary { background: var(--c-surface); color: var(--c-ink); border-color: var(--c-line); }
.danger { background: var(--c-surface); color: var(--c-danger); border-color: var(--c-danger); }
```

`app/src/components/Spinner.tsx`:
```tsx
import { useTranslation } from 'react-i18next';

export function Spinner() {
  const { t } = useTranslation();
  return <p role="status">{t('common.loading')}</p>;
}
```

`app/src/components/ErrorBanner.tsx`:
```tsx
import { useTranslation } from 'react-i18next';
import styles from './ErrorBanner.module.css';

export function ErrorBanner({ message }: { message?: string }) {
  const { t } = useTranslation();
  return <p role="alert" className={styles.banner}>{message ?? t('common.error')}</p>;
}
```

`app/src/components/ErrorBanner.module.css`:
```css
.banner {
  margin: var(--s-3) 0;
  padding: var(--s-3);
  border: 1px solid var(--c-danger);
  border-radius: var(--radius);
  color: var(--c-danger);
  background: var(--c-surface);
}
```

- [ ] **Step 6: Implement the session context**

`app/src/session/SessionContext.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase.js';
import { useDoc } from '../hooks/useDoc.js';
import type { Language } from '../i18n/index.js';
import type { DeductionRule } from '@money-kids/shared';

export interface Family {
  id: string;
  name: string;
  language: Language;
  currency: string;
  createdBy: string;
  deductionRules: DeductionRule[];
}

export interface Session {
  user: User | null;
  familyId: string | null;
  family: Family | null;
  role: 'parent' | null;
  status: 'loading' | 'signed-out' | 'no-family' | 'ready';
}

const SessionCtx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setAuthResolved(true);
  }), []);

  const pointer = useDoc<{ familyId: string }>(user ? `parentIndex/${user.uid}` : null);
  const familyId = pointer.data?.familyId ?? null;
  const family = useDoc<Family>(familyId ? `families/${familyId}` : null);

  let status: Session['status'] = 'loading';
  if (!authResolved) status = 'loading';
  else if (!user) status = 'signed-out';
  // a missing pointer is the normal state for a parent who has not created a
  // family yet, and also for one whose invite acceptance is mid-flight
  else if (pointer.loading || (familyId && family.loading)) status = 'loading';
  else if (!familyId) status = 'no-family';
  else if (family.data) status = 'ready';
  else status = 'no-family';

  return (
    <SessionCtx.Provider
      value={{
        user,
        familyId,
        family: family.data,
        role: status === 'ready' ? 'parent' : null,
        status,
      }}
    >
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('useSession must be used inside a SessionProvider');
  return s;
}
```

- [ ] **Step 7: Implement the sign-in screen**

Add to both i18n files (`es` shown; mirror in `en`):
```json
  "signIn": {
    "title": "Entrar",
    "email": "Correo",
    "password": "Contraseña",
    "submit": "Iniciar sesión",
    "create": "Crear cuenta",
    "google": "Continuar con Google",
    "failed": "No pudimos entrar. Revisa el correo y la contraseña."
  }
```
(`en`: `"title": "Sign in", "email": "Email", "password": "Password", "submit": "Sign in", "create": "Create account", "google": "Continue with Google", "failed": "We couldn't sign you in. Check the email and password."`)

`app/src/screens/SignIn.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup,
} from 'firebase/auth';
import { auth } from '../firebase.js';
import { Button } from '../components/Button.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import styles from './SignIn.module.css';

export function SignIn() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      // the specific Firebase code is deliberately not shown: it distinguishes
      // "no such account" from "wrong password", which is an enumeration leak
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.screen}>
      <h1>{t('signIn.title')}</h1>
      {failed && <ErrorBanner message={t('signIn.failed')} />}
      <label htmlFor="email">{t('signIn.email')}</label>
      <input
        id="email" type="email" autoComplete="email" value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label htmlFor="password">{t('signIn.password')}</label>
      <input
        id="password" type="password" autoComplete="current-password" value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button
        disabled={busy}
        onClick={() => run(() => signInWithEmailAndPassword(auth, email, password))}
      >
        {t('signIn.submit')}
      </Button>
      <Button
        variant="secondary" disabled={busy}
        onClick={() => run(() => createUserWithEmailAndPassword(auth, email, password))}
      >
        {t('signIn.create')}
      </Button>
      <Button
        variant="secondary" disabled={busy}
        onClick={() => run(() => signInWithPopup(auth, new GoogleAuthProvider()))}
      >
        {t('signIn.google')}
      </Button>
    </main>
  );
}
```

`app/src/screens/SignIn.module.css`:
```css
.screen {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding: var(--s-5) var(--s-4);
  max-width: 26rem;
  margin: 0 auto;
}
.screen input {
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--c-line);
  border-radius: var(--radius);
  min-height: var(--tap);
}
.screen label { font-size: var(--f-small); color: var(--c-ink-soft); }
```

- [ ] **Step 8: Verify**

Run: `npm run test:app && npm run test:rules && npm run typecheck`
Expected: all PASS. The Google button is not covered by a test — `signInWithPopup` needs a real browser popup; Plan 3's Playwright pass covers it, and that is a deliberate gap, not an omission.

- [ ] **Step 9: Commit**

```bash
git add app firestore.rules packages/rules-tests
git commit -m "feat(app): session context, parent family pointer, and sign-in"
```

---

### Task 7: Family creation and the app shell

**Files:**
- Create: `app/src/screens/CreateFamily.tsx`, `app/src/screens/CreateFamily.test.tsx`, `app/src/components/BottomTabs.tsx`, `app/src/components/BottomTabs.module.css`, `app/src/components/Money.tsx`, `app/src/routes.tsx`
- Modify: `app/src/App.tsx`, `app/src/App.test.tsx`, `app/src/main.tsx`, `app/src/i18n/*.json`

**Interfaces:**
- Consumes: `useSession`, `Button`, `ErrorBanner`, `parseMajor`/`formatMinor`.
- Produces:
  - `<CreateFamily />` — writes `families/{id}` + `members/{uid}` + `parentIndex/{uid}` in **one batch**
  - `<Money amount={minor} />` — the only place money is rendered; reads currency and language from the session
  - `<BottomTabs />` and `routes.tsx`, which later tasks extend with their own route entries
  - `SUPPORTED_CURRENCIES: readonly string[]` = `['COP', 'USD', 'EUR', 'MXN', 'ARS', 'CLP', 'PEN', 'BRL']`

- [ ] **Step 1: Write the failing tests**

`app/src/screens/CreateFamily.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { signInTestParent, clearFirestoreData } from '../test/emulator.js';
import { SessionProvider } from '../session/SessionContext.js';
import { CreateFamily } from './CreateFamily.js';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('founder');
});

function renderScreen() {
  return render(<SessionProvider><CreateFamily /></SessionProvider>);
}

describe('CreateFamily', () => {
  it('creates family, founder member doc, and parent pointer in one batch', async () => {
    renderScreen();
    await userEvent.type(screen.getByLabelText(/nombre de la familia/i), 'Talero');
    await userEvent.selectOptions(screen.getByLabelText(/moneda/i), 'COP');
    await userEvent.click(screen.getByRole('button', { name: /crear familia/i }));

    const uid = auth.currentUser!.uid;
    await waitFor(async () => {
      const pointer = await getDoc(doc(db, 'parentIndex', uid));
      expect(pointer.exists()).toBe(true);
    });
    const familyId = (await getDoc(doc(db, 'parentIndex', uid))).get('familyId') as string;
    const family = await getDoc(doc(db, 'families', familyId));
    expect(family.get('name')).toBe('Talero');
    expect(family.get('currency')).toBe('COP');
    expect(family.get('deductionRules')).toEqual([]);
    const member = await getDoc(doc(db, `families/${familyId}/members`, uid));
    expect(member.get('role')).toBe('parent');
  });

  it('requires a name and warns that currency is permanent', async () => {
    renderScreen();
    expect(screen.getByText(/no se puede cambiar/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /crear familia/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const uid = auth.currentUser!.uid;
    expect((await getDoc(doc(db, 'parentIndex', uid))).exists()).toBe(false);
  });
});
```

`app/src/App.test.tsx` — replace the Task 4 body:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { signOut } from 'firebase/auth';
import { auth } from './firebase.js';
import { initI18n } from './i18n/index.js';
import { clearFirestoreData, signInTestParent } from './test/emulator.js';
import { App } from './App.js';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); });

describe('App routing by session status', () => {
  it('shows sign-in when signed out', async () => {
    await signOut(auth);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: /entrar/i })).toBeInTheDocument());
  });
  it('shows family creation for a parent with no family', async () => {
    await signInTestParent('brandnew');
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/nombre de la familia/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:app`
Expected: FAIL — `CreateFamily.js` and the routing do not exist.

- [ ] **Step 3: Add the i18n keys**

`es.json` additions (mirror in `en.json`):
```json
  "createFamily": {
    "title": "Crea tu familia",
    "name": "Nombre de la familia",
    "language": "Idioma",
    "currency": "Moneda",
    "permanent": "La moneda no se puede cambiar después.",
    "submit": "Crear familia",
    "nameRequired": "Escribe un nombre para la familia."
  }
```
(`en`: `"title": "Create your family", "name": "Family name", "language": "Language", "currency": "Currency", "permanent": "The currency cannot be changed later.", "submit": "Create family", "nameRequired": "Enter a name for the family."`)

- [ ] **Step 4: Implement `<Money>` and `<CreateFamily>`**

`app/src/components/Money.tsx`:
```tsx
import { formatMinor } from '@money-kids/shared';
import { useSession } from '../session/SessionContext.js';

/** The single place minor units become text. Never format money inline. */
export function Money({ amount, currency }: { amount: number; currency?: string }) {
  const { family } = useSession();
  const code = currency ?? family?.currency ?? 'USD';
  const locale = (family?.language ?? 'es') === 'es' ? 'es-CO' : 'en-US';
  return <span>{formatMinor(amount, code, locale)}</span>;
}
```

`app/src/screens/CreateFamily.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { Button } from '../components/Button.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import type { Language } from '../i18n/index.js';
import styles from './SignIn.module.css';

export const SUPPORTED_CURRENCIES = ['COP', 'USD', 'EUR', 'MXN', 'ARS', 'CLP', 'PEN', 'BRL'] as const;

export function CreateFamily() {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>((i18n.language as Language) ?? 'es');
  const [currency, setCurrency] = useState<string>('COP');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (name.trim() === '') {
      setError(t('createFamily.nameRequired'));
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setBusy(true);
    setError(null);
    try {
      // one batch: the rules reject a family without its founder member doc,
      // and parentIndex requires the member doc to exist after the write
      const familyRef = doc(collection(db, 'families'));
      const batch = writeBatch(db);
      batch.set(familyRef, {
        name: name.trim(), language, currency, createdBy: uid, deductionRules: [],
      });
      batch.set(doc(db, `families/${familyRef.id}/members`, uid), {
        role: 'parent',
        displayName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? 'Parent',
      });
      batch.set(doc(db, 'parentIndex', uid), { familyId: familyRef.id });
      await batch.commit();
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.screen}>
      <h1>{t('createFamily.title')}</h1>
      {error && <ErrorBanner message={error} />}
      <label htmlFor="fam-name">{t('createFamily.name')}</label>
      <input id="fam-name" value={name} onChange={(e) => setName(e.target.value)} />

      <label htmlFor="fam-language">{t('createFamily.language')}</label>
      <select
        id="fam-language" value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
      >
        <option value="es">Español</option>
        <option value="en">English</option>
      </select>

      <label htmlFor="fam-currency">{t('createFamily.currency')}</label>
      <select id="fam-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
        {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <p>{t('createFamily.permanent')}</p>

      <Button disabled={busy} onClick={create}>{t('createFamily.submit')}</Button>
    </main>
  );
}
```

- [ ] **Step 5: Implement the shell**

`app/src/components/BottomTabs.tsx`:
```tsx
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styles from './BottomTabs.module.css';

export interface TabDef { to: string; labelKey: string; badge?: number }

export function BottomTabs({ tabs }: { tabs: TabDef[] }) {
  const { t } = useTranslation();
  return (
    <nav className={styles.tabs} aria-label={t('nav.inbox')}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to} to={tab.to}
          className={({ isActive }) => (isActive ? `${styles.tab} ${styles.active}` : styles.tab)}
        >
          <span>{t(tab.labelKey)}</span>
          {tab.badge ? <span className={styles.badge}>{tab.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}
```

`app/src/components/BottomTabs.module.css`:
```css
.tabs {
  position: fixed;
  inset: auto 0 0 0;
  display: grid;
  grid-auto-flow: column;
  border-top: 1px solid var(--c-line);
  background: var(--c-surface);
  padding-bottom: env(safe-area-inset-bottom);
}
.tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-1);
  min-height: var(--tap);
  padding: var(--s-2);
  font-size: var(--f-small);
  color: var(--c-ink-soft);
  text-decoration: none;
}
.active { color: var(--c-accent); font-weight: 600; }
.badge {
  min-width: 1.25rem;
  padding: 0 var(--s-1);
  border-radius: 999px;
  background: var(--c-danger);
  color: #fff;
  font-size: var(--f-small);
  text-align: center;
}
```

`app/src/routes.tsx` — later tasks append entries to `PARENT_TABS` and `parentRoutes`:
```tsx
import type { ReactElement } from 'react';

export interface RouteDef { path: string; element: ReactElement }

export const PARENT_TABS = [
  { to: '/inbox', labelKey: 'nav.inbox' },
] as const;

export const parentRoutes: RouteDef[] = [];
```

`app/src/App.tsx`:
```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './session/SessionContext.js';
import { SignIn } from './screens/SignIn.js';
import { CreateFamily } from './screens/CreateFamily.js';
import { BottomTabs } from './components/BottomTabs.js';
import { Spinner } from './components/Spinner.js';
import { PARENT_TABS, parentRoutes } from './routes.js';

/**
 * The signed-in shell is its OWN component, not a branch inside Shell.
 * Task 11 adds a hook here for the inbox badge, and a hook must never sit
 * after an early return — so the status guards live in Shell and every
 * parent-only hook lives in ParentShell, which only renders once ready.
 */
function ParentShell() {
  return (
    <>
      <main>
        <Routes>
          {parentRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
          <Route path="*" element={<Navigate to={PARENT_TABS[0].to} replace />} />
        </Routes>
      </main>
      <BottomTabs tabs={PARENT_TABS.map((tab) => ({ ...tab }))} />
    </>
  );
}

function Shell() {
  const { status } = useSession();
  if (status === 'loading') return <main><Spinner /></main>;
  if (status === 'signed-out') return <SignIn />;
  if (status === 'no-family') return <CreateFamily />;
  return <ParentShell />;
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS. Note `CreateFamily.test.tsx` renders the screen directly (no router), which is why the screen itself contains no `<Link>`.

- [ ] **Step 7: Commit**

```bash
git add app
git commit -m "feat(app): family creation in one batch and the parent app shell"
```

---

### Task 8: Kid profiles, join codes, and revocation

**Files:**
- Create: `app/src/lib/callables.ts`, `app/src/screens/Kids.tsx`, `app/src/screens/Kids.module.css`, `app/src/screens/Kids.test.tsx`, `app/src/components/Card.tsx`, `app/src/components/Card.module.css`
- Modify: `app/src/routes.tsx`, `app/src/i18n/*.json`

**Interfaces:**
- Consumes: Plan 1's callables `createJoinCode`, `revokeKidAccess`; `useCollection`; `useSession`.
- Produces:
  - `app/src/lib/callables.ts` — typed wrappers, the **only** place `httpsCallable` is used:
    - `createJoinCode(input: { familyId: string; kidId: string }): Promise<{ code: string }>`
    - `revokeKidAccess(input: { familyId: string; kidId: string }): Promise<void>`
    - `approveInvoice(input: { familyId: string; invoiceId: string }): Promise<{ approvedAmount: number; netAmount: number }>`
    - `recordPayout(input: { familyId: string; kidId: string; balance: 'spendable' | 'savings'; amount: number; note: string; requestId: string }): Promise<void>`
    - `setDeductionRules(input: { familyId: string; rules: DeductionRule[] }): Promise<void>`
  - `<Kids />` at `/kids`

- [ ] **Step 1: Write the failing tests**

`app/src/screens/Kids.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { collection, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, signInTestParent } from '../test/emulator.js';
import { SessionProvider } from '../session/SessionContext.js';
import { Kids } from './Kids.js';

let familyId: string;

beforeAll(async () => { await initI18n('es'); });

beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('kidsparent');
  const uid = auth.currentUser!.uid;
  familyId = 'famK';
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(db, `families/${familyId}/members`, uid), { role: 'parent', displayName: 'Leo' });
  batch.set(doc(db, 'parentIndex', uid), { familyId });
  await batch.commit();
});

function renderScreen() {
  return render(<SessionProvider><Kids /></SessionProvider>);
}

describe('Kids', () => {
  it('adds a kid with zero balances', async () => {
    renderScreen();
    await userEvent.type(await screen.findByLabelText(/nombre/i), 'Mia');
    await userEvent.type(screen.getByLabelText(/año de nacimiento/i), '2016');
    await userEvent.click(screen.getByRole('button', { name: /agregar/i }));
    await waitFor(async () => {
      const kids = await getDocs(collection(db, `families/${familyId}/kids`));
      expect(kids.size).toBe(1);
      expect(kids.docs[0].get('spendableBalance')).toBe(0);
      expect(kids.docs[0].get('savingsBalance')).toBe(0);
      expect(kids.docs[0].get('deductionsEnabled')).toBe(false);
    });
  });

  it('lists kids with balances and toggles deductions', async () => {
    await setDoc(doc(db, `families/${familyId}/kids/k1`), {
      name: 'Mia', birthYear: 2016, deductionsEnabled: false,
      spendableBalance: 7000, savingsBalance: 2000,
    });
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    expect(card).toHaveTextContent(/7[.,]?000/);
    await userEvent.click(within(card).getByRole('checkbox', { name: /deducciones/i }));
    await waitFor(async () => {
      const kids = await getDocs(collection(db, `families/${familyId}/kids`));
      expect(kids.docs[0].get('deductionsEnabled')).toBe(true);
    });
  });

  it('shows a join code from the callable and can revoke access', async () => {
    await setDoc(doc(db, `families/${familyId}/kids/k1`), {
      name: 'Mia', birthYear: 2016, deductionsEnabled: false,
      spendableBalance: 0, savingsBalance: 0,
    });
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    await userEvent.click(within(card).getByRole('button', { name: /código/i }));
    // the code is 8 characters from the join-code alphabet
    await waitFor(() => expect(within(card).getByTestId('join-code').textContent)
      .toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/));
    await userEvent.click(within(card).getByRole('button', { name: /revocar/i }));
    await waitFor(() => expect(within(card).queryByTestId('join-code')).toBeNull());
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:app`
Expected: FAIL — `Kids.js` does not exist. (These tests need the functions emulator too — see Step 5.)

- [ ] **Step 3: Implement the callable wrappers**

`app/src/lib/callables.ts`:
```ts
import { httpsCallable } from 'firebase/functions';
import type { DeductionRule } from '@money-kids/shared';
import { fns } from '../firebase.js';

/**
 * Every money mutation goes through here. Components never call httpsCallable
 * directly, and never write ledger/balances/approved status to Firestore.
 */
export const createJoinCode =
  httpsCallable<{ familyId: string; kidId: string }, { code: string }>(fns, 'createJoinCode');

export const revokeKidAccess =
  httpsCallable<{ familyId: string; kidId: string }, void>(fns, 'revokeKidAccess');

export const approveInvoice =
  httpsCallable<{ familyId: string; invoiceId: string }, { approvedAmount: number; netAmount: number }>(
    fns, 'approveInvoice');

export const recordPayout =
  httpsCallable<{
    familyId: string; kidId: string; balance: 'spendable' | 'savings';
    amount: number; note: string; requestId: string;
  }, void>(fns, 'recordPayout');

export const setDeductionRules =
  httpsCallable<{ familyId: string; rules: DeductionRule[] }, void>(fns, 'setDeductionRules');
```

- [ ] **Step 4: Implement `<Card>` and `<Kids>`**

`app/src/components/Card.tsx`:
```tsx
import type { ReactNode } from 'react';
import styles from './Card.module.css';

export function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section role="group" aria-label={label} className={styles.card}>
      {children}
    </section>
  );
}
```

`app/src/components/Card.module.css`:
```css
.card {
  border: 1px solid var(--c-line);
  border-radius: var(--radius);
  background: var(--c-surface);
  box-shadow: var(--shadow);
  padding: var(--s-4);
  margin-bottom: var(--s-3);
}
```

Add to `es.json` (mirror in `en.json`):
```json
  "kids": {
    "title": "Niños",
    "name": "Nombre",
    "birthYear": "Año de nacimiento",
    "add": "Agregar niño",
    "deductions": "Deducciones",
    "code": "Mostrar código",
    "codeHelp": "Escribe este código en el dispositivo del niño.",
    "revoke": "Revocar acceso",
    "invalidYear": "Escribe un año entre 2005 y este año."
  }
```
(`en`: `"title": "Kids", "name": "Name", "birthYear": "Birth year", "add": "Add kid", "deductions": "Deductions", "code": "Show code", "codeHelp": "Enter this code on the kid's device.", "revoke": "Revoke access", "invalidYear": "Enter a year between 2005 and this year."`)

`app/src/screens/Kids.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, query, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { createJoinCode, revokeKidAccess } from '../lib/callables.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { Money } from '../components/Money.js';
import { Spinner } from '../components/Spinner.js';
import styles from './Kids.module.css';

interface Kid {
  id: string;
  name: string;
  birthYear: number;
  deductionsEnabled: boolean;
  spendableBalance: number;
  savingsBalance: number;
}

export function Kids() {
  const { t } = useTranslation();
  const { familyId } = useSession();
  const kids = useCollection<Kid>(familyId ? query(collection(db, `families/${familyId}/kids`)) : null);
  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function addKid() {
    const year = Number(birthYear);
    const thisYear = new Date().getFullYear();
    if (name.trim() === '' || !Number.isInteger(year) || year < 2005 || year > thisYear) {
      setError(t('kids.invalidYear'));
      return;
    }
    setError(null);
    // balances must be exactly 0 on create — the rules reject anything else
    await setDoc(doc(collection(db, `families/${familyId}/kids`)), {
      name: name.trim(), birthYear: year, deductionsEnabled: false,
      spendableBalance: 0, savingsBalance: 0,
    });
    setName('');
    setBirthYear('');
  }

  async function showCode(kidId: string) {
    setError(null);
    try {
      const { data } = await createJoinCode({ familyId: familyId!, kidId });
      setCodes((prev) => ({ ...prev, [kidId]: data.code }));
    } catch {
      setError(t('common.error'));
    }
  }

  async function revoke(kidId: string) {
    setError(null);
    try {
      await revokeKidAccess({ familyId: familyId!, kidId });
      setCodes((prev) => {
        const next = { ...prev };
        delete next[kidId];
        return next;
      });
    } catch {
      setError(t('common.error'));
    }
  }

  return (
    <div className={styles.screen}>
      <h1>{t('kids.title')}</h1>
      {error && <ErrorBanner message={error} />}

      <Card label={t('kids.add')}>
        <label htmlFor="kid-name">{t('kids.name')}</label>
        <input id="kid-name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="kid-year">{t('kids.birthYear')}</label>
        <input
          id="kid-year" inputMode="numeric" value={birthYear}
          onChange={(e) => setBirthYear(e.target.value)}
        />
        <Button onClick={addKid}>{t('kids.add')}</Button>
      </Card>

      {kids.loading && <Spinner />}
      {kids.docs.map((kid) => (
        <Card key={kid.id} label={kid.name}>
          <h2>{kid.name}</h2>
          <p>
            {t('money.spendable')}: <Money amount={kid.spendableBalance} />
            {' · '}
            {t('money.savings')}: <Money amount={kid.savingsBalance} />
          </p>
          <label>
            <input
              type="checkbox" checked={kid.deductionsEnabled}
              onChange={(e) => updateDoc(doc(db, `families/${familyId}/kids/${kid.id}`), {
                deductionsEnabled: e.target.checked,
              })}
            />
            {t('kids.deductions')}
          </label>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => showCode(kid.id)}>{t('kids.code')}</Button>
            <Button variant="danger" onClick={() => revoke(kid.id)}>{t('kids.revoke')}</Button>
          </div>
          {codes[kid.id] && (
            <p>
              <code data-testid="join-code">{codes[kid.id]}</code>
              <br />
              <small>{t('kids.codeHelp')}</small>
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}
```

`app/src/screens/Kids.module.css`:
```css
.screen { padding: var(--s-4) var(--s-4) calc(var(--tap) + var(--s-6)); }
.screen input {
  display: block;
  width: 100%;
  margin-bottom: var(--s-3);
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--c-line);
  border-radius: var(--radius);
  min-height: var(--tap);
}
.screen label { font-size: var(--f-small); color: var(--c-ink-soft); }
.actions { display: flex; gap: var(--s-2); flex-wrap: wrap; }
```

Register the route in `app/src/routes.tsx`:
```tsx
import { Kids } from './screens/Kids.js';

export const PARENT_TABS = [
  { to: '/inbox', labelKey: 'nav.inbox' },
  { to: '/kids', labelKey: 'nav.kids' },
] as const;

export const parentRoutes: RouteDef[] = [
  { path: '/kids', element: <Kids /> },
];
```

- [ ] **Step 5: Add functions to the test emulator set**

The join-code test calls a real callable, so `test:app` must run the functions emulator and the bundle must be built first. Update the root script:
```json
    "test:app": "npm run build -w @money-kids/functions && firebase emulators:exec --only firestore,auth,functions --project money-kids-test \"npm test -w @money-kids/app\""
```

- [ ] **Step 6: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS. If the callable rejects with `unauthenticated`, the app is not sending the ID token to the emulated function — confirm `connectFunctionsEmulator` runs before the first call and that the test signed in first.

- [ ] **Step 7: Commit**

```bash
git add app package.json
git commit -m "feat(app): kid profiles, join codes, and access revocation"
```

---

### Task 9: Additional-parent invites

**Design decision:** invites use a **code**, mirroring Plan 1's kid join codes, rather than email matching. This was chosen deliberately with the tradeoff understood: anyone holding the code becomes a parent with full approval and payout rights, so the code is single-use, expires in 7 days, is revocable, and every acceptance is recorded and visible in Settings. Email delivery is out of scope — the parent shares the code out-of-band.

**Files:**
- Create: `functions/src/parentInvites.ts`, `functions/src/parentInvites.test.ts`, `app/src/screens/JoinParent.tsx`, `app/src/screens/JoinParent.test.tsx`
- Modify: `functions/src/index.ts`, `app/src/lib/callables.ts`, `app/src/screens/Settings.tsx` (created here), `app/src/screens/CreateFamily.tsx` (adds the `/join` link), `app/src/screens/CreateFamily.test.tsx` (wrap in `MemoryRouter` once that link exists), `app/src/App.tsx`, `app/src/routes.tsx`, `app/src/i18n/*.json`

**Interfaces:**
- Consumes: `assertParentCaller`, `checked`, `validateId`, `validateJoinCode` (Plan 1).
- Produces:
  - `createParentInviteCore(db, auth, { familyId }): Promise<{ code: string }>` — parent-only
  - `acceptParentInviteCore(db, auth, { code }): Promise<{ familyId: string }>` — any signed-in non-kid user; writes `members/{uid}` **and** `parentIndex/{uid}` and marks the invite used, in one transaction
  - `listParentInvitesCore` is **not** needed — Settings reads `families/{id}/inviteLog` directly under rules
  - Callables: `createParentInvite`, `acceptParentInvite`

**Storage shape:** invites live at top level, like `joinCodes`, because they are looked up by code before the caller has any family membership:
- `parentInvites/{code}` — `{ familyId, createdBy, expiresAt, usedBy: string | null, usedAt: Timestamp | null }`. **Client access is denied entirely** (both read and write) — the code is a credential, and a readable collection would let anyone enumerate valid codes.
- `families/{familyId}/inviteLog/{code}` — `{ createdBy, createdAt, usedBy, usedAt }`, written by the callable, **readable by family parents** so Settings can show who invited whom. Client writes denied.

- [ ] **Step 1: Write the failing rules tests**

Add to `packages/rules-tests/src/ledger.test.ts` (it already covers the server-only collections):
```ts
describe('parent invites are server-only', () => {
  it('no client can read or write parentInvites', async () => {
    const pdb = parentCtx(env, 'p1').firestore();
    await assertFails(getDoc(doc(pdb, 'parentInvites/ABCD2345')));
    await assertFails(setDoc(doc(pdb, 'parentInvites/ABCD2345'), { familyId: 'fam1' }));
  });
  it('family parents read the invite log but cannot write it', async () => {
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'families/fam1/inviteLog/ABCD2345'), {
        createdBy: 'p1', createdAt: new Date(), usedBy: null, usedAt: null,
      });
    });
    const pdb = parentCtx(env, 'p1').firestore();
    await assertSucceeds(getDoc(doc(pdb, 'families/fam1/inviteLog/ABCD2345')));
    await assertFails(setDoc(doc(pdb, 'families/fam1/inviteLog/XXXX2345'), { createdBy: 'p1' }));
  });
});
```

- [ ] **Step 2: Add the rules, run the tests**

Add inside the `families/{familyId}` match block:
```
      match /inviteLog/{code} {
        // audit trail written by the callable; parents read it in Settings
        allow read: if isFamilyParent();
        allow write: if false;
      }
```
`parentInvites` needs no block at all — the catch-all deny already covers it, and the test above proves that. Run `npm run test:rules` → PASS.

- [ ] **Step 3: Write the failing function tests**

`functions/src/parentInvites.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { createParentInviteCore, acceptParentInviteCore } from './parentInvites.js';

let db: Firestore;
const parentAuth = { uid: 'p1', token: {} } as never;
const newcomerAuth = { uid: 'p3', token: {} } as never;
const kidAuth = { uid: 'kid_fam1_k1', token: { role: 'kid', familyId: 'fam1', kidId: 'k1' } } as never;

beforeAll(() => {
  process.env.GCLOUD_PROJECT = 'money-kids-test';
  if (getApps().length === 0) initializeApp({ projectId: 'money-kids-test' });
  db = getFirestore();
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  await db.recursiveDelete(db.collection('families').doc('fam2'));
  for (const c of (await db.collection('parentInvites').get()).docs) await c.ref.delete();
  for (const c of (await db.collection('parentIndex').get()).docs) await c.ref.delete();
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/fam2').set({ name: 'Other', language: 'en', currency: 'USD', createdBy: 'p2', deductionRules: [] });
  await db.doc('families/fam2/members/p2').set({ role: 'parent', displayName: 'Ana' });
});

describe('createParentInviteCore', () => {
  it('a parent creates a code recorded in the family invite log', async () => {
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    const invite = await db.doc(`parentInvites/${code}`).get();
    expect(invite.get('familyId')).toBe('fam1');
    expect(invite.get('usedBy')).toBeNull();
    const log = await db.doc(`families/fam1/inviteLog/${code}`).get();
    expect(log.get('createdBy')).toBe('p1');
  });
  it('rejects kid tokens, strangers, and a real parent of another family', async () => {
    await expect(createParentInviteCore(db, kidAuth, { familyId: 'fam1' })).rejects.toThrow();
    await expect(createParentInviteCore(db, { uid: 'stranger', token: {} } as never, { familyId: 'fam1' }))
      .rejects.toThrow(/not a member/i);
    await expect(createParentInviteCore(db, { uid: 'p2', token: {} } as never, { familyId: 'fam1' }))
      .rejects.toThrow(/not a member/i);
    await expect(createParentInviteCore(db, parentAuth, { familyId: 'fam2' }))
      .rejects.toThrow(/not a member/i);
  });
  it('rejects a malformed familyId before it reaches a path', async () => {
    await expect(createParentInviteCore(db, parentAuth, { familyId: 'fam1/../fam2' }))
      .rejects.toThrow(/familyId/);
  });
});

describe('acceptParentInviteCore', () => {
  it('makes the newcomer a parent and points them at the family', async () => {
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    const { familyId } = await acceptParentInviteCore(db, newcomerAuth, { code });
    expect(familyId).toBe('fam1');
    expect((await db.doc('families/fam1/members/p3').get()).get('role')).toBe('parent');
    expect((await db.doc('parentIndex/p3').get()).get('familyId')).toBe('fam1');
    const log = await db.doc(`families/fam1/inviteLog/${code}`).get();
    expect(log.get('usedBy')).toBe('p3');
  });
  it('is single-use', async () => {
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    await acceptParentInviteCore(db, newcomerAuth, { code });
    await expect(acceptParentInviteCore(db, { uid: 'p4', token: {} } as never, { code }))
      .rejects.toThrow(/invalid/i);
    expect((await db.doc('families/fam1/members/p4').get()).exists).toBe(false);
  });
  it('rejects expired, unknown, and malformed codes identically', async () => {
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    await db.doc(`parentInvites/${code}`).update({ expiresAt: new Date(Date.now() - 1000) });
    await expect(acceptParentInviteCore(db, newcomerAuth, { code })).rejects.toThrow(/invalid/i);
    for (const bad of ['', 'abc', 'abcd2345', 'ABCD/../X', 'ABCD2340']) {
      await expect(acceptParentInviteCore(db, newcomerAuth, { code: bad })).rejects.toThrow(/invalid/i);
    }
  });
  it('rejects a kid token even with a valid code', async () => {
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    await expect(acceptParentInviteCore(db, kidAuth, { code })).rejects.toThrow(/parent/i);
    expect((await db.doc('families/fam1/members/kid_fam1_k1').get()).exists).toBe(false);
  });
  it('refuses a caller who already belongs to another family', async () => {
    // one parent, one family in v1: a second pointer would be unreachable and
    // parentIndex is immutable by rule, so this must fail before any write
    const { code } = await createParentInviteCore(db, parentAuth, { familyId: 'fam1' });
    await db.doc('parentIndex/p2').set({ familyId: 'fam2' });
    await expect(acceptParentInviteCore(db, { uid: 'p2', token: {} } as never, { code }))
      .rejects.toThrow(/already belongs/i);
    expect((await db.doc('parentIndex/p2').get()).get('familyId')).toBe('fam2');
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — `parentInvites.js` not found.

- [ ] **Step 5: Implement**

`functions/src/parentInvites.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { validateId, validateJoinCode } from '@money-kids/shared';
import { checked, assertParentCaller, type CallerAuth } from './auth.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function randomCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export async function createParentInviteCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { familyId: string },
): Promise<{ code: string }> {
  checked(() => validateId(data.familyId, 'familyId'));
  await assertParentCaller(db, data.familyId, auth);
  const code = randomCode();
  const now = Timestamp.now();
  const batch = db.batch();
  batch.create(db.doc(`parentInvites/${code}`), {
    familyId: data.familyId,
    createdBy: auth!.uid,
    expiresAt: Timestamp.fromMillis(now.toMillis() + INVITE_TTL_MS),
    usedBy: null,
    usedAt: null,
  });
  // the log is what Settings shows; the invite doc itself is never client-readable
  batch.create(db.doc(`families/${data.familyId}/inviteLog/${code}`), {
    createdBy: auth!.uid, createdAt: now, usedBy: null, usedAt: null,
  });
  await batch.commit();
  return { code };
}

export async function acceptParentInviteCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { code: string },
): Promise<{ familyId: string }> {
  if (!auth) throw new HttpsError('unauthenticated', 'sign in required');
  // a kid session must never become a parent, whatever code it holds
  if (auth.token.role === 'kid') throw new HttpsError('permission-denied', 'parent account required');

  const invalid = new HttpsError('permission-denied', 'invalid or expired invite');
  let code: string;
  try {
    code = validateJoinCode(data.code);
  } catch {
    throw invalid; // malformed and wrong must be indistinguishable
  }

  return db.runTransaction(async (tx) => {
    const inviteRef = db.doc(`parentInvites/${code}`);
    const invite = await tx.get(inviteRef);
    if (!invite.exists) throw invalid;
    const familyId = invite.get('familyId') as string;
    const expiresAt = invite.get('expiresAt') as Timestamp;
    if (invite.get('usedBy') !== null || expiresAt.toMillis() < Date.now()) throw invalid;

    const pointerRef = db.doc(`parentIndex/${auth.uid}`);
    const pointer = await tx.get(pointerRef);
    if (pointer.exists && pointer.get('familyId') !== familyId) {
      throw new HttpsError('failed-precondition', 'this account already belongs to another family');
    }

    tx.update(inviteRef, { usedBy: auth.uid, usedAt: FieldValue.serverTimestamp() });
    tx.update(db.doc(`families/${familyId}/inviteLog/${code}`), {
      usedBy: auth.uid, usedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.doc(`families/${familyId}/members/${auth.uid}`), {
      role: 'parent',
      displayName: (auth.token.name as string | undefined) ?? 'Parent',
    });
    tx.set(pointerRef, { familyId });
    return { familyId };
  });
}
```

Add to `functions/src/index.ts`:
```ts
import { createParentInviteCore, acceptParentInviteCore } from './parentInvites.js';

export const createParentInvite = onCall(async (req) =>
  createParentInviteCore(getFirestore(), req.auth, req.data));

export const acceptParentInvite = onCall(async (req) =>
  acceptParentInviteCore(getFirestore(), req.auth, req.data));
```

Add to `app/src/lib/callables.ts`:
```ts
export const createParentInvite =
  httpsCallable<{ familyId: string }, { code: string }>(fns, 'createParentInvite');

export const acceptParentInvite =
  httpsCallable<{ code: string }, { familyId: string }>(fns, 'acceptParentInvite');
```

- [ ] **Step 6: Write the failing UI test**

`app/src/screens/JoinParent.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, signInTestParent } from '../test/emulator.js';
import { JoinParent } from './JoinParent.js';

beforeAll(async () => { await initI18n('es'); });
beforeEach(async () => { await clearFirestoreData(); });

describe('JoinParent', () => {
  it('rejects a bad code with a visible error and no membership', async () => {
    await signInTestParent('joiner');
    render(<JoinParent />);
    await userEvent.type(screen.getByLabelText(/código/i), 'ABCD2345');
    await userEvent.click(screen.getByRole('button', { name: /unirme/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    const uid = auth.currentUser!.uid;
    expect((await getDoc(doc(db, 'parentIndex', uid))).exists()).toBe(false);
  });
});
```
(The happy path needs a second signed-in identity to mint the invite; it is covered end-to-end by the function tests above and by Plan 3's Playwright pass. This test proves the failure path is visible rather than silent.)

- [ ] **Step 7: Implement the screen**

Add to `es.json` (mirror in `en.json`):
```json
  "joinParent": {
    "title": "Unirme a una familia",
    "code": "Código de invitación",
    "submit": "Unirme",
    "failed": "Ese código no es válido o ya se usó."
  },
  "settings": {
    "title": "Ajustes",
    "invites": "Invitar a otro adulto",
    "createInvite": "Crear código",
    "inviteHelp": "El código sirve una sola vez y vence en 7 días. Quien lo tenga podrá aprobar facturas y registrar pagos.",
    "inviteUsedBy": "Usado por",
    "inviteUnused": "Sin usar",
    "language": "Idioma"
  }
```
(`en`: `"joinParent": { "title": "Join a family", "code": "Invite code", "submit": "Join", "failed": "That code is not valid or was already used." }`, `"settings": { "title": "Settings", "invites": "Invite another adult", "createInvite": "Create code", "inviteHelp": "The code works once and expires in 7 days. Whoever holds it can approve invoices and record payouts.", "inviteUsedBy": "Used by", "inviteUnused": "Unused", "language": "Language" }`)

`app/src/screens/JoinParent.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { acceptParentInvite } from '../lib/callables.js';
import { Button } from '../components/Button.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import styles from './SignIn.module.css';

export function JoinParent() {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setFailed(false);
    try {
      await acceptParentInvite({ code: code.trim().toUpperCase() });
      // the session's parentIndex listener picks up the new pointer on its own
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.screen}>
      <h1>{t('joinParent.title')}</h1>
      {failed && <ErrorBanner message={t('joinParent.failed')} />}
      <label htmlFor="invite-code">{t('joinParent.code')}</label>
      <input
        id="invite-code" value={code} autoCapitalize="characters"
        onChange={(e) => setCode(e.target.value)}
      />
      <Button disabled={busy} onClick={join}>{t('joinParent.submit')}</Button>
    </main>
  );
}
```

`app/src/screens/Settings.tsx` — created here with the invites section; Tasks 13 and 14 add their own sections to this same file:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { createParentInvite } from '../lib/callables.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import styles from './Kids.module.css';

interface InviteLogEntry { id: string; createdBy: string; usedBy: string | null }

export function Settings() {
  const { t, i18n } = useTranslation();
  const { familyId } = useSession();
  const invites = useCollection<InviteLogEntry>(
    familyId ? query(collection(db, `families/${familyId}/inviteLog`)) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite() {
    setBusy(true);
    setError(null);
    try {
      await createParentInvite({ familyId: familyId! });
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.screen}>
      <h1>{t('settings.title')}</h1>
      {error && <ErrorBanner message={error} />}

      <Card label={t('settings.invites')}>
        <h2>{t('settings.invites')}</h2>
        <p><small>{t('settings.inviteHelp')}</small></p>
        <Button disabled={busy} onClick={invite}>{t('settings.createInvite')}</Button>
        <ul>
          {invites.docs.map((entry) => (
            <li key={entry.id}>
              <code>{entry.id}</code>{' — '}
              {entry.usedBy ? `${t('settings.inviteUsedBy')} ${entry.usedBy}` : t('settings.inviteUnused')}
            </li>
          ))}
        </ul>
      </Card>

      <Card label={t('settings.language')}>
        <h2>{t('settings.language')}</h2>
        <select
          aria-label={t('settings.language')} value={i18n.language}
          onChange={(e) => i18n.changeLanguage(e.target.value)}
        >
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </Card>
    </div>
  );
}
```

Register both routes in `routes.tsx` (add `{ to: '/settings', labelKey: 'nav.settings' }` to `PARENT_TABS`, and `{ path: '/settings', element: <Settings /> }` plus `{ path: '/join', element: <JoinParent /> }` to `parentRoutes`). `JoinParent` must **also** be reachable while `status === 'no-family'` — add it to `App.tsx`'s no-family branch:
```tsx
  if (status === 'no-family') {
    return (
      <Routes>
        <Route path="/join" element={<JoinParent />} />
        <Route path="*" element={<CreateFamily />} />
      </Routes>
    );
  }
```
and add a link from `CreateFamily` to `/join` so an invited parent can reach it (`<Link to="/join">{t('joinParent.title')}</Link>`; import `Link` from `react-router-dom`, and wrap `CreateFamily` in a `MemoryRouter` in its own test).

- [ ] **Step 8: Verify**

Run: `npm run test:functions && npm run test:app && npm run test:rules && npm run typecheck`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add functions app firestore.rules packages/rules-tests
git commit -m "feat: single-use parent invite codes with an auditable invite log"
```

---

### Task 10: Activity board and the bilingual starter catalog

**Files:**
- Create: `app/src/lib/catalog.ts`, `app/src/lib/catalog.test.ts`, `app/src/screens/Activities.tsx`, `app/src/screens/Activities.test.tsx`, `app/src/components/PillarIcon.tsx`
- Modify: `app/src/routes.tsx`, `app/src/i18n/*.json`

**Interfaces:**
- Produces:
  - `type Pillar = 'learn' | 'courage' | 'ideas' | 'help'`
  - `interface CatalogEntry { titleEs: string; titleEn: string; descriptionEs: string; descriptionEn: string; suggestedMajor: number; category: Pillar; repeatable: boolean }`
  - `STARTER_CATALOG: readonly CatalogEntry[]` — the catalog cannot know the family's currency, so an entry carries `suggestedMajor` (**whole major units**), never a minor-unit figure. The Firestore document's field is `suggestedPrice` and is always minor units. **Keep the two names distinct — conflating them is a 100× money bug.**
  - `catalogPriceInMinor(major: number, currency: string): number` — scales by `10 ** minorDigits(currency)`
  - `seedCatalog(familyId: string, currency: string, uid: string): Promise<void>`
  - `<Activities />` at `/activities`

- [ ] **Step 1: Write the failing catalog test**

`app/src/lib/catalog.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { STARTER_CATALOG, catalogPriceInMinor } from './catalog.js';

describe('starter catalog', () => {
  it('covers all four pillars', () => {
    const pillars = new Set(STARTER_CATALOG.map((e) => e.category));
    expect([...pillars].sort()).toEqual(['courage', 'help', 'ideas', 'learn']);
  });
  it('is fully bilingual with rule-safe lengths', () => {
    for (const entry of STARTER_CATALOG) {
      expect(entry.titleEs.length).toBeGreaterThan(0);
      expect(entry.titleEn.length).toBeGreaterThan(0);
      // the activity rules cap titles at 80 and descriptions at 500
      expect(entry.titleEs.length).toBeLessThanOrEqual(80);
      expect(entry.titleEn.length).toBeLessThanOrEqual(80);
      expect(entry.descriptionEs.length).toBeLessThanOrEqual(500);
      expect(entry.descriptionEn.length).toBeLessThanOrEqual(500);
    }
  });
  it('scales suggested prices into the family currency minor units', () => {
    // 5 major units is 500 cents in USD but 5 pesos in COP
    expect(catalogPriceInMinor(5, 'USD')).toBe(500);
    expect(catalogPriceInMinor(5, 'COP')).toBe(5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:app`
Expected: FAIL — `catalog.js` does not exist.

- [ ] **Step 3: Implement the catalog**

`app/src/lib/catalog.ts`:
```ts
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { minorDigits } from '@money-kids/shared';
import { db } from '../firebase.js';

export type Pillar = 'learn' | 'courage' | 'ideas' | 'help';

export interface CatalogEntry {
  titleEs: string;
  titleEn: string;
  descriptionEs: string;
  descriptionEn: string;
  /** in whole major units of whatever currency the family uses */
  suggestedMajor: number;
  category: Pillar;
  repeatable: boolean;
}

/** A catalog price is currency-agnostic, so it scales at seed time. */
export function catalogPriceInMinor(major: number, currency: string): number {
  return major * 10 ** minorDigits(currency);
}

export const STARTER_CATALOG: readonly CatalogEntry[] = [
  {
    titleEs: 'Lee un libro y cuéntamelo',
    titleEn: 'Read a book and tell me about it',
    descriptionEs: 'Lee un libro o un capítulo y explícame de qué se trata con tus palabras.',
    descriptionEn: 'Read a book or a chapter and explain what it was about in your own words.',
    suggestedMajor: 5, category: 'learn', repeatable: true,
  },
  {
    titleEs: 'Enséñame algo que aprendiste',
    titleEn: 'Teach me something you learned',
    descriptionEs: 'Explícame algo nuevo que aprendiste esta semana, como si yo no supiera nada.',
    descriptionEn: 'Explain something new you learned this week, as if I knew nothing about it.',
    suggestedMajor: 4, category: 'learn', repeatable: true,
  },
  {
    titleEs: 'Haz algo que te daba miedo',
    titleEn: 'Do something that scared you',
    descriptionEs: 'Cuéntame qué te daba miedo, qué hiciste y cómo te sentiste después.',
    descriptionEn: 'Tell me what scared you, what you did, and how you felt afterwards.',
    suggestedMajor: 8, category: 'courage', repeatable: true,
  },
  {
    titleEs: 'Habla en público o pide algo tú solo',
    titleEn: 'Speak up in public or ask for something yourself',
    descriptionEs: 'Pide algo en una tienda, saluda a alguien nuevo o habla frente al grupo.',
    descriptionEn: 'Order something in a shop, greet someone new, or speak in front of a group.',
    suggestedMajor: 6, category: 'courage', repeatable: true,
  },
  {
    titleEs: 'Trae una idea pensada',
    titleEn: 'Bring a thought-through idea',
    descriptionEs: 'Una idea útil para la casa o la familia, con el por qué y cómo se haría.',
    descriptionEn: 'A useful idea for the home or the family, with why it helps and how it would work.',
    suggestedMajor: 7, category: 'ideas', repeatable: true,
  },
  {
    titleEs: 'Resuelve un problema que viste',
    titleEn: 'Solve a problem you noticed',
    descriptionEs: 'Encuentra algo que no funciona bien en casa y propón cómo arreglarlo.',
    descriptionEn: 'Find something that does not work well at home and propose how to fix it.',
    suggestedMajor: 7, category: 'ideas', repeatable: true,
  },
  {
    titleEs: 'Ayuda con la cocina',
    titleEn: 'Help with a meal',
    descriptionEs: 'Ayuda a preparar o a recoger, y déjalo mejor de como lo encontraste.',
    descriptionEn: 'Help cook or clean up, and leave it better than you found it.',
    suggestedMajor: 3, category: 'help', repeatable: true,
  },
  {
    titleEs: 'Cuida a tu hermano o hermana',
    titleEn: 'Look after your brother or sister',
    descriptionEs: 'Juega, ayuda con la tarea o acompáñalo un rato sin que nadie te lo pida.',
    descriptionEn: 'Play, help with homework, or keep them company without being asked.',
    suggestedMajor: 5, category: 'help', repeatable: true,
  },
];

/** Writes the whole catalog in one batch, scaled to the family currency. */
export async function seedCatalog(familyId: string, currency: string, uid: string): Promise<void> {
  const batch = writeBatch(db);
  for (const entry of STARTER_CATALOG) {
    batch.set(doc(collection(db, `families/${familyId}/activities`)), {
      titleEs: entry.titleEs,
      titleEn: entry.titleEn,
      descriptionEs: entry.descriptionEs,
      descriptionEn: entry.descriptionEn,
      suggestedPrice: catalogPriceInMinor(entry.suggestedMajor, currency),
      category: entry.category,
      repeatable: entry.repeatable,
      active: true,
      createdBy: uid,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
}
```


- [ ] **Step 4: Write the failing screen test**

`app/src/screens/Activities.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, signInTestParent } from '../test/emulator.js';
import { SessionProvider } from '../session/SessionContext.js';
import { Activities } from './Activities.js';

const familyId = 'famA';

beforeAll(async () => { await initI18n('es'); });

beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('actparent');
  const uid = auth.currentUser!.uid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(db, `families/${familyId}/members`, uid), { role: 'parent', displayName: 'Leo' });
  batch.set(doc(db, 'parentIndex', uid), { familyId });
  await batch.commit();
});

function renderScreen() {
  return render(<SessionProvider><Activities /></SessionProvider>);
}

describe('Activities', () => {
  it('seeds the starter catalog and shows it grouped by pillar', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /catálogo/i }));
    await waitFor(async () => {
      const activities = await getDocs(collection(db, `families/${familyId}/activities`));
      expect(activities.size).toBe(8);
      // every seeded doc must satisfy the activity rules, including attribution
      expect(activities.docs[0].get('createdBy')).toBe(auth.currentUser!.uid);
      expect(activities.docs[0].get('active')).toBe(true);
    });
    expect(await screen.findByText(/Lee un libro/)).toBeInTheDocument();
  });

  it('creates a custom activity and deactivates it', async () => {
    renderScreen();
    await userEvent.type(await screen.findByLabelText(/título/i), 'Ordena tu cuarto');
    await userEvent.type(screen.getByLabelText(/precio/i), '2000');
    await userEvent.selectOptions(screen.getByLabelText(/categoría/i), 'help');
    await userEvent.click(screen.getByRole('button', { name: /crear actividad/i }));

    const card = await screen.findByRole('group', { name: /Ordena tu cuarto/ });
    await userEvent.click(within(card).getByRole('checkbox', { name: /activa/i }));
    await waitFor(async () => {
      const activities = await getDocs(collection(db, `families/${familyId}/activities`));
      expect(activities.docs[0].get('active')).toBe(false);
      // attribution survives the edit unchanged
      expect(activities.docs[0].get('createdBy')).toBe(auth.currentUser!.uid);
    });
  });

  it('rejects a title longer than the rules allow, before writing', async () => {
    renderScreen();
    await userEvent.type(await screen.findByLabelText(/título/i), 'x'.repeat(81));
    await userEvent.type(screen.getByLabelText(/precio/i), '1000');
    await userEvent.click(screen.getByRole('button', { name: /crear actividad/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const activities = await getDocs(collection(db, `families/${familyId}/activities`));
    expect(activities.size).toBe(0);
  });
});
```

- [ ] **Step 5: Run to verify it fails, then implement**

Run: `npm run test:app` → FAIL (no `Activities.js`).

Add to `es.json` (mirror in `en.json`):
```json
  "activities": {
    "title": "Actividades",
    "seed": "Cargar catálogo inicial",
    "create": "Crear actividad",
    "titleField": "Título",
    "description": "Descripción",
    "price": "Precio sugerido",
    "category": "Categoría",
    "repeatable": "Se puede repetir",
    "active": "Activa",
    "tooLong": "El título es demasiado largo (máximo 80 caracteres).",
    "badPrice": "Escribe un precio válido.",
    "pillars": { "learn": "Aprender", "courage": "Valentía", "ideas": "Ideas", "help": "Ayudar" }
  }
```
(`en`: `"title": "Activities", "seed": "Load starter catalog", "create": "Create activity", "titleField": "Title", "description": "Description", "price": "Suggested price", "category": "Category", "repeatable": "Can be repeated", "active": "Active", "tooLong": "The title is too long (80 characters maximum).", "badPrice": "Enter a valid price.", "pillars": { "learn": "Learn", "courage": "Courage", "ideas": "Ideas", "help": "Help" }`)

`app/src/components/PillarIcon.tsx`:
```tsx
import type { Pillar } from '../lib/catalog.js';

const EMOJI: Record<Pillar, string> = {
  learn: '📚', courage: '🦁', ideas: '💡', help: '🤝',
};

export function PillarIcon({ pillar }: { pillar: Pillar }) {
  return <span aria-hidden="true">{EMOJI[pillar]}</span>;
}
```

`app/src/screens/Activities.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { parseMajor } from '@money-kids/shared';
import { auth, db } from '../firebase.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { seedCatalog, type Pillar } from '../lib/catalog.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { Money } from '../components/Money.js';
import { PillarIcon } from '../components/PillarIcon.js';
import styles from './Kids.module.css';

const PILLARS: Pillar[] = ['learn', 'courage', 'ideas', 'help'];

interface Activity {
  id: string;
  titleEs: string; titleEn: string;
  descriptionEs: string; descriptionEn: string;
  suggestedPrice: number; category: Pillar;
  repeatable: boolean; active: boolean;
}

export function Activities() {
  const { t, i18n } = useTranslation();
  const { familyId, family } = useSession();
  const activities = useCollection<Activity>(
    familyId ? query(collection(db, `families/${familyId}/activities`)) : null,
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<Pillar>('learn');
  const [repeatable, setRepeatable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isEs = i18n.language === 'es';

  async function create() {
    if (title.trim().length === 0 || title.trim().length > 80) {
      setError(t('activities.tooLong'));
      return;
    }
    let minor: number;
    try {
      // grouping separators are stripped here; parseMajor is deliberately strict
      minor = parseMajor(price.replace(/[^\d.,]/g, ''), family!.currency);
    } catch {
      setError(t('activities.badPrice'));
      return;
    }
    setError(null);
    const uid = auth.currentUser!.uid;
    await setDoc(doc(collection(db, `families/${familyId}/activities`)), {
      titleEs: title.trim(), titleEn: title.trim(),
      descriptionEs: description.trim(), descriptionEn: description.trim(),
      suggestedPrice: minor, category, repeatable, active: true,
      createdBy: uid, createdAt: serverTimestamp(),
    });
    setTitle('');
    setDescription('');
    setPrice('');
  }

  async function setActive(activity: Activity, active: boolean) {
    // a partial update is fine: the rules see the merged document, and the
    // untouched createdBy/createdAt satisfy their immutability checks
    await updateDoc(doc(db, `families/${familyId}/activities/${activity.id}`), { active });
  }

  return (
    <div className={styles.screen}>
      <h1>{t('activities.title')}</h1>
      {error && <ErrorBanner message={error} />}

      {activities.docs.length === 0 && (
        <Button onClick={() => seedCatalog(familyId!, family!.currency, auth.currentUser!.uid)}>
          {t('activities.seed')}
        </Button>
      )}

      <Card label={t('activities.create')}>
        <label htmlFor="act-title">{t('activities.titleField')}</label>
        <input id="act-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="act-desc">{t('activities.description')}</label>
        <input id="act-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        <label htmlFor="act-price">{t('activities.price')}</label>
        <input id="act-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        <label htmlFor="act-cat">{t('activities.category')}</label>
        <select
          id="act-cat" value={category}
          onChange={(e) => setCategory(e.target.value as Pillar)}
        >
          {PILLARS.map((p) => <option key={p} value={p}>{t(`activities.pillars.${p}`)}</option>)}
        </select>
        <label>
          <input
            type="checkbox" checked={repeatable}
            onChange={(e) => setRepeatable(e.target.checked)}
          />
          {t('activities.repeatable')}
        </label>
        <Button onClick={create}>{t('activities.create')}</Button>
      </Card>

      {PILLARS.map((pillar) => {
        const inPillar = activities.docs.filter((a) => a.category === pillar);
        if (inPillar.length === 0) return null;
        return (
          <section key={pillar}>
            <h2><PillarIcon pillar={pillar} /> {t(`activities.pillars.${pillar}`)}</h2>
            {inPillar.map((activity) => (
              <Card key={activity.id} label={isEs ? activity.titleEs : activity.titleEn}>
                <h3>{isEs ? activity.titleEs : activity.titleEn}</h3>
                <p>{isEs ? activity.descriptionEs : activity.descriptionEn}</p>
                <p><Money amount={activity.suggestedPrice} /></p>
                <label>
                  <input
                    type="checkbox" checked={activity.active}
                    onChange={(e) => setActive(activity, e.target.checked)}
                  />
                  {t('activities.active')}
                </label>
              </Card>
            ))}
          </section>
        );
      })}
    </div>
  );
}
```

Register the route: add `{ to: '/activities', labelKey: 'nav.activities' }` to `PARENT_TABS` and `{ path: '/activities', element: <Activities /> }` to `parentRoutes`.

- [ ] **Step 6: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add app
git commit -m "feat(app): activity board with the bilingual starter catalog"
```

---

### Task 11: Invoice inbox, detail, and the three parent decisions

**This is the task the whole product exists for.** Approve goes through the callable; return and counter are client batches that must carry their event. Get the batching wrong and the rules reject the write — which is the design working, not a bug to route around.

**Files:**
- Create: `app/src/lib/invoiceActions.ts`, `app/src/lib/invoiceActions.test.ts`, `app/src/screens/Inbox.tsx`, `app/src/screens/Inbox.test.tsx`, `app/src/screens/InvoiceDetail.tsx`, `app/src/screens/InvoiceDetail.module.css`
- Modify: `app/src/firebase.ts` (export `storage`), `app/src/routes.tsx`, `app/src/App.tsx` (badge count), `firestore.indexes.json`, `app/src/i18n/*.json`

**Interfaces:**
- Consumes: `approveInvoice` callable; `useCollection`, `useDoc`.
- Produces:
  - `returnInvoice(familyId: string, invoice: InvoiceDoc, note: string): Promise<void>`
  - `counterInvoice(familyId: string, invoice: InvoiceDoc, amount: number, note: string): Promise<void>`
  - `interface InvoiceDoc { id: string; kidId: string; activityId: string | null; description: string; photoPaths: string[]; status: 'draft' | 'sent' | 'approved' | 'countered' | 'returned'; requestedAmount: number; eventCount: number; createdAt: Timestamp; counterOffer?: { amount: number; note?: string; parentId: string; at: Timestamp }; approvedAmount?: number; netAmount?: number; deductions?: DeductionLine[] }`
  - `<Inbox />` at `/inbox`, `<InvoiceDetail />` at `/invoice/:invoiceId`
  - `usePendingCount(): number` — drives the tab badge

- [ ] **Step 1: Add the composite index the inbox needs**

The inbox query is `where('status','==','sent')` ordered by `createdAt` — a composite index in production. Add to `firestore.indexes.json`'s `indexes` array:
```json
    {
      "collectionGroup": "invoices",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
```

- [ ] **Step 2: Write the failing action tests**

`app/src/lib/invoiceActions.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { clearFirestoreData, signInTestParent } from '../test/emulator.js';
import { returnInvoice, counterInvoice, type InvoiceDoc } from './invoiceActions.js';

const familyId = 'famI';
let uid: string;

beforeAll(async () => { await signInTestParent('actionparent'); });

beforeEach(async () => {
  await clearFirestoreData();
  uid = auth.currentUser!.uid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(db, `families/${familyId}/members`, uid), { role: 'parent', displayName: 'Leo' });
  batch.set(doc(db, 'parentIndex', uid), { familyId });
  await batch.commit();
  // a sent invoice with one prior event, as the kid would have left it
  await setDoc(doc(db, `families/${familyId}/invoices/inv1`), {
    kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
    status: 'sent', requestedAmount: 5000, eventCount: 1, createdAt: serverTimestamp(),
  });
});

async function loadInvoice(): Promise<InvoiceDoc> {
  const snap = await getDoc(doc(db, `families/${familyId}/invoices/inv1`));
  return { ...snap.data(), id: snap.id } as InvoiceDoc;
}

describe('returnInvoice', () => {
  it('transitions to returned and writes the paired event', async () => {
    await returnInvoice(familyId, await loadInvoice(), 'Cuéntame más');
    const snap = await getDoc(doc(db, `families/${familyId}/invoices/inv1`));
    expect(snap.get('status')).toBe('returned');
    expect(snap.get('eventCount')).toBe(2);
    const event = await getDoc(doc(db, `families/${familyId}/invoices/inv1/events/e2`));
    expect(event.get('from')).toBe('sent');
    expect(event.get('to')).toBe('returned');
    expect(event.get('actorUid')).toBe(uid);
    expect(event.get('note')).toBe('Cuéntame más');
    expect(event.get('kidId')).toBe('k1');
    // requestedAmount belongs only to -> sent events
    expect(event.get('requestedAmount')).toBeUndefined();
  });

  it('rejects a note longer than the rules allow, leaving the invoice untouched', async () => {
    await expect(returnInvoice(familyId, await loadInvoice(), 'x'.repeat(501))).rejects.toThrow();
    const snap = await getDoc(doc(db, `families/${familyId}/invoices/inv1`));
    expect(snap.get('status')).toBe('sent');
    expect((await getDocs(collection(db, `families/${familyId}/invoices/inv1/events`))).size).toBe(0);
  });
});

describe('counterInvoice', () => {
  it('records the counter-offer with the acting parent and a server time', async () => {
    await counterInvoice(familyId, await loadInvoice(), 3000, 'Un poco menos');
    const snap = await getDoc(doc(db, `families/${familyId}/invoices/inv1`));
    expect(snap.get('status')).toBe('countered');
    expect(snap.get('counterOffer').amount).toBe(3000);
    expect(snap.get('counterOffer').parentId).toBe(uid);
    expect(snap.get('counterOffer').at).toBeTruthy();
    const event = await getDoc(doc(db, `families/${familyId}/invoices/inv1/events/e2`));
    expect(event.get('to')).toBe('countered');
  });

  it('refuses a non-positive or non-integer amount before writing', async () => {
    const invoice = await loadInvoice();
    await expect(counterInvoice(familyId, invoice, 0, '')).rejects.toThrow(/amount/i);
    await expect(counterInvoice(familyId, invoice, -100, '')).rejects.toThrow(/amount/i);
    await expect(counterInvoice(familyId, invoice, 12.5, '')).rejects.toThrow(/amount/i);
    expect((await loadInvoice()).status).toBe('sent');
  });

  it('cannot act on an invoice that is not sent', async () => {
    await counterInvoice(familyId, await loadInvoice(), 3000, '');
    // already countered: the rules only allow sent -> countered
    await expect(counterInvoice(familyId, await loadInvoice(), 2000, '')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:app`
Expected: FAIL — `invoiceActions.js` does not exist.

- [ ] **Step 4: Implement the actions**

`app/src/lib/invoiceActions.ts`:
```ts
import { doc, serverTimestamp, writeBatch, type Timestamp } from 'firebase/firestore';
import type { DeductionLine } from '@money-kids/shared';
import { auth, db } from '../firebase.js';

export interface InvoiceDoc {
  id: string;
  kidId: string;
  activityId: string | null;
  description: string;
  photoPaths: string[];
  status: 'draft' | 'sent' | 'approved' | 'countered' | 'returned';
  requestedAmount: number;
  eventCount: number;
  createdAt: Timestamp;
  counterOffer?: { amount: number; note?: string; parentId: string; at: Timestamp };
  approvedAmount?: number;
  netAmount?: number;
  deductions?: DeductionLine[];
}

const MAX_NOTE = 500;

/**
 * A transition and its event MUST be one batch: the invoice rule requires
 * existsAfter(events/e{newEventCount}) and the event rule validates `from`
 * against the pre-batch status. Writing either alone is denied.
 */
export async function returnInvoice(
  familyId: string, invoice: InvoiceDoc, note: string,
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('not signed in');
  if (note.length > MAX_NOTE) throw new Error(`note must be at most ${MAX_NOTE} characters`);
  const nextCount = invoice.eventCount + 1;
  const batch = writeBatch(db);
  batch.update(doc(db, `families/${familyId}/invoices/${invoice.id}`), {
    status: 'returned', eventCount: nextCount,
  });
  batch.set(doc(db, `families/${familyId}/invoices/${invoice.id}/events/e${nextCount}`), {
    from: invoice.status, to: 'returned', actorUid: uid,
    at: serverTimestamp(), note, kidId: invoice.kidId,
  });
  await batch.commit();
}

export async function counterInvoice(
  familyId: string, invoice: InvoiceDoc, amount: number, note: string,
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('not signed in');
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('amount must be a positive integer in minor units');
  }
  if (note.length > MAX_NOTE) throw new Error(`note must be at most ${MAX_NOTE} characters`);
  const nextCount = invoice.eventCount + 1;
  const batch = writeBatch(db);
  batch.update(doc(db, `families/${familyId}/invoices/${invoice.id}`), {
    status: 'countered',
    eventCount: nextCount,
    // parentId and at are rule-checked against the caller and server time
    counterOffer: { amount, note, parentId: uid, at: serverTimestamp() },
  });
  batch.set(doc(db, `families/${familyId}/invoices/${invoice.id}/events/e${nextCount}`), {
    from: invoice.status, to: 'countered', actorUid: uid,
    at: serverTimestamp(), note, kidId: invoice.kidId,
  });
  await batch.commit();
}
```

Add the Storage export to `app/src/firebase.ts` (the detail screen needs photo URLs):
```ts
import { connectStorageEmulator, getStorage } from 'firebase/storage';
export const storage = getStorage(app);
// inside the emulator block:
  connectStorageEmulator(storage, '127.0.0.1', 9199);
```

- [ ] **Step 5: Write the failing screen tests**

`app/src/screens/Inbox.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, signInTestParent } from '../test/emulator.js';
import { SessionProvider } from '../session/SessionContext.js';
import { Inbox } from './Inbox.js';
import { InvoiceDetail } from './InvoiceDetail.js';

const familyId = 'famB';

beforeAll(async () => { await initI18n('es'); });

beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('inboxparent');
  const uid = auth.currentUser!.uid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid,
    deductionRules: [
      { nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000, destination: 'savings' },
    ],
  });
  batch.set(doc(db, `families/${familyId}/members`, uid), { role: 'parent', displayName: 'Leo' });
  batch.set(doc(db, 'parentIndex', uid), { familyId });
  batch.set(doc(db, `families/${familyId}/kids/k1`), {
    name: 'Mia', birthYear: 2016, deductionsEnabled: true,
    spendableBalance: 0, savingsBalance: 0,
  });
  await batch.commit();
  await setDoc(doc(db, `families/${familyId}/invoices/inv1`), {
    kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
    status: 'sent', requestedAmount: 5000, eventCount: 1, createdAt: serverTimestamp(),
  });
});

function renderAt(path: string) {
  return render(
    <SessionProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/invoice/:invoiceId" element={<InvoiceDetail />} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe('Inbox', () => {
  it('lists pending invoices with the kid name and amount', async () => {
    renderAt('/inbox');
    const item = await screen.findByRole('link', { name: /Mia/ });
    expect(item).toHaveTextContent(/5[.,]?000/);
  });
  it('says so when nothing is pending', async () => {
    await setDoc(doc(db, `families/${familyId}/invoices/inv1`), {
      kidId: 'k1', activityId: null, description: 'x', photoPaths: [],
      status: 'approved', requestedAmount: 5000, approvedAmount: 5000, netAmount: 5000,
      deductions: [], eventCount: 2, createdAt: serverTimestamp(),
    });
    renderAt('/inbox');
    expect(await screen.findByText(/no hay facturas/i)).toBeInTheDocument();
  });
});

describe('InvoiceDetail', () => {
  it('approves through the callable, showing the deduction breakdown after', async () => {
    renderAt('/invoice/inv1');
    await userEvent.click(await screen.findByRole('button', { name: /aprobar/i }));
    await waitFor(async () => {
      const snap = await getDoc(doc(db, `families/${familyId}/invoices/inv1`));
      expect(snap.get('status')).toBe('approved');
      expect(snap.get('netAmount')).toBe(4000); // 5000 less 20% savings
    });
    // the credit and the kid balance are the callable's job, not the client's
    const credit = await getDoc(doc(db, `families/${familyId}/ledger/credit_inv1`));
    expect(credit.get('amount')).toBe(4000);
    expect((await getDoc(doc(db, `families/${familyId}/kids/k1`))).get('savingsBalance')).toBe(1000);
  });

  it('returns with feedback', async () => {
    renderAt('/invoice/inv1');
    await userEvent.type(await screen.findByLabelText(/mensaje/i), 'Cuéntame más');
    await userEvent.click(screen.getByRole('button', { name: /devolver/i }));
    await waitFor(async () => {
      expect((await getDoc(doc(db, `families/${familyId}/invoices/inv1`))).get('status')).toBe('returned');
    });
  });

  it('counters with a different amount typed in major units', async () => {
    renderAt('/invoice/inv1');
    await userEvent.type(await screen.findByLabelText(/otro monto/i), '3000');
    await userEvent.click(screen.getByRole('button', { name: /contraofertar/i }));
    await waitFor(async () => {
      const snap = await getDoc(doc(db, `families/${familyId}/invoices/inv1`));
      expect(snap.get('status')).toBe('countered');
      // COP has 0 minor digits, so 3000 typed is 3000 minor units
      expect(snap.get('counterOffer').amount).toBe(3000);
    });
  });

  it('shows an error when the callable rejects, without changing the invoice', async () => {
    await setDoc(doc(db, `families/${familyId}/invoices/inv1`), {
      kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
      status: 'returned', requestedAmount: 5000, eventCount: 2, createdAt: serverTimestamp(),
    });
    renderAt('/invoice/inv1');
    await userEvent.click(await screen.findByRole('button', { name: /aprobar/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect((await getDoc(doc(db, `families/${familyId}/invoices/inv1`))).get('status')).toBe('returned');
  });
});
```

- [ ] **Step 6: Implement the screens**

Add to `es.json` (mirror in `en.json`):
```json
  "inbox": {
    "title": "Facturas pendientes",
    "empty": "No hay facturas pendientes.",
    "requested": "Pide",
    "history": "Historia",
    "photos": "Fotos"
  },
  "review": {
    "approve": "Aprobar",
    "return": "Devolver con comentario",
    "counter": "Contraofertar",
    "note": "Mensaje para el niño",
    "counterAmount": "Otro monto",
    "gross": "Monto aprobado",
    "net": "Va al disponible",
    "badAmount": "Escribe un monto válido.",
    "noteTooLong": "El mensaje es demasiado largo (máximo 500 caracteres)."
  }
```
(`en`: `"inbox": { "title": "Pending invoices", "empty": "No pending invoices.", "requested": "Asks for", "history": "History", "photos": "Photos" }`, `"review": { "approve": "Approve", "return": "Return with feedback", "counter": "Counter-offer", "note": "Message for the kid", "counterAmount": "Different amount", "gross": "Approved amount", "net": "Goes to spendable", "badAmount": "Enter a valid amount.", "noteTooLong": "The message is too long (500 characters maximum)." }`)

`app/src/screens/Inbox.tsx`:
```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { Card } from '../components/Card.js';
import { Money } from '../components/Money.js';
import { Spinner } from '../components/Spinner.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import type { InvoiceDoc } from '../lib/invoiceActions.js';
import styles from './Kids.module.css';

interface Kid { id: string; name: string }

/** Pending count for the tab badge; shares the query, so no extra reads. */
export function usePendingCount(): number {
  const { familyId } = useSession();
  const pending = useCollection<InvoiceDoc>(
    familyId
      ? query(collection(db, `families/${familyId}/invoices`), where('status', '==', 'sent'))
      : null,
  );
  return pending.docs.length;
}

export function Inbox() {
  const { t } = useTranslation();
  const { familyId } = useSession();
  const invoices = useCollection<InvoiceDoc>(
    familyId
      ? query(
          collection(db, `families/${familyId}/invoices`),
          where('status', '==', 'sent'),
          orderBy('createdAt', 'desc'),
        )
      : null,
  );
  const kids = useCollection<Kid>(familyId ? query(collection(db, `families/${familyId}/kids`)) : null);
  const nameFor = (kidId: string) => kids.docs.find((k) => k.id === kidId)?.name ?? kidId;

  if (invoices.loading) return <div className={styles.screen}><Spinner /></div>;
  if (invoices.error) return <div className={styles.screen}><ErrorBanner /></div>;

  return (
    <div className={styles.screen}>
      <h1>{t('inbox.title')}</h1>
      {invoices.docs.length === 0 && <p>{t('inbox.empty')}</p>}
      {invoices.docs.map((invoice) => (
        <Link key={invoice.id} to={`/invoice/${invoice.id}`} aria-label={nameFor(invoice.kidId)}>
          <Card label={`${nameFor(invoice.kidId)} ${invoice.id}`}>
            <strong>{nameFor(invoice.kidId)}</strong>
            <p>{invoice.description}</p>
            <p>{t('inbox.requested')}: <Money amount={invoice.requestedAmount} /></p>
          </Card>
        </Link>
      ))}
    </div>
  );
}
```

`app/src/screens/InvoiceDetail.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { collection, orderBy, query } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { parseMajor } from '@money-kids/shared';
import { db, storage } from '../firebase.js';
import { useDoc } from '../hooks/useDoc.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { approveInvoice } from '../lib/callables.js';
import { counterInvoice, returnInvoice, type InvoiceDoc } from '../lib/invoiceActions.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { Money } from '../components/Money.js';
import { Spinner } from '../components/Spinner.js';
import styles from './InvoiceDetail.module.css';

interface EventDoc {
  id: string;
  from: string;
  to: string;
  actorUid: string;
  note?: string;
  requestedAmount?: number;
}

export function InvoiceDetail() {
  const { t } = useTranslation();
  const { invoiceId } = useParams();
  const { familyId, family } = useSession();
  const invoice = useDoc<InvoiceDoc>(
    familyId && invoiceId ? `families/${familyId}/invoices/${invoiceId}` : null,
  );
  const events = useCollection<EventDoc>(
    familyId && invoiceId
      ? query(collection(db, `families/${familyId}/invoices/${invoiceId}/events`), orderBy('at', 'asc'))
      : null,
  );
  const [note, setNote] = useState('');
  const [counterText, setCounterText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  const data = invoice.data;

  useEffect(() => {
    if (!data?.photoPaths?.length) {
      setPhotoUrls([]);
      return;
    }
    let live = true;
    Promise.all(data.photoPaths.map((p) => getDownloadURL(ref(storage, p)).catch(() => null)))
      .then((urls) => { if (live) setPhotoUrls(urls.filter((u): u is string => u !== null)); });
    return () => { live = false; };
  }, [data?.photoPaths]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message ?? t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  if (invoice.loading) return <div className={styles.screen}><Spinner /></div>;
  if (invoice.error || !data) return <div className={styles.screen}><ErrorBanner /></div>;

  const isPending = data.status === 'sent';

  return (
    <div className={styles.screen}>
      <h1>{data.description}</h1>
      <p className={styles.amount}>
        {t('inbox.requested')}: <Money amount={data.requestedAmount} />
      </p>
      {error && <ErrorBanner message={error} />}

      {photoUrls.length > 0 && (
        <Card label={t('inbox.photos')}>
          <div className={styles.photos}>
            {photoUrls.map((url) => <img key={url} src={url} alt="" />)}
          </div>
        </Card>
      )}

      {data.status === 'approved' && data.deductions && (
        <Card label={t('review.gross')}>
          <p>{t('review.gross')}: <Money amount={data.approvedAmount ?? 0} /></p>
          <ul>
            {data.deductions.map((line) => (
              <li key={line.nameEn}>
                {family?.language === 'en' ? line.nameEn : line.nameEs}
                {' −'}<Money amount={line.amount} />
              </li>
            ))}
          </ul>
          <p><strong>{t('review.net')}: <Money amount={data.netAmount ?? 0} /></strong></p>
        </Card>
      )}

      {isPending && (
        <Card label={t('review.approve')}>
          <Button
            disabled={busy}
            onClick={() => run(() => approveInvoice({ familyId: familyId!, invoiceId: data.id }))}
          >
            {t('review.approve')}
          </Button>

          <label htmlFor="review-note">{t('review.note')}</label>
          <textarea
            id="review-note" value={note} maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            variant="secondary" disabled={busy}
            onClick={() => run(() => returnInvoice(familyId!, data, note))}
          >
            {t('review.return')}
          </Button>

          <label htmlFor="counter-amount">{t('review.counterAmount')}</label>
          <input
            id="counter-amount" inputMode="decimal" value={counterText}
            onChange={(e) => setCounterText(e.target.value)}
          />
          <Button
            variant="secondary" disabled={busy}
            onClick={() => run(async () => {
              let minor: number;
              try {
                minor = parseMajor(counterText.replace(/[^\d.,]/g, ''), family!.currency);
              } catch {
                throw new Error(t('review.badAmount'));
              }
              await counterInvoice(familyId!, data, minor, note);
            })}
          >
            {t('review.counter')}
          </Button>
        </Card>
      )}

      <Card label={t('inbox.history')}>
        <h2>{t('inbox.history')}</h2>
        <ol>
          {events.docs.map((event) => (
            <li key={event.id}>
              {event.from} → {event.to}
              {event.requestedAmount !== undefined && <> (<Money amount={event.requestedAmount} />)</>}
              {event.note ? ` — ${event.note}` : ''}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
```

`app/src/screens/InvoiceDetail.module.css`:
```css
.screen { padding: var(--s-4) var(--s-4) calc(var(--tap) + var(--s-6)); }
.amount { font-size: var(--f-money); color: var(--c-money); font-weight: 700; }
.photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr)); gap: var(--s-2); }
.photos img { width: 100%; border-radius: var(--radius); }
.screen textarea, .screen input {
  display: block; width: 100%; margin-bottom: var(--s-3);
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--c-line); border-radius: var(--radius);
}
.screen label { font-size: var(--f-small); color: var(--c-ink-soft); }
```

Register the routes and wire the badge. In `routes.tsx` add `{ path: '/inbox', element: <Inbox /> }` and `{ path: '/invoice/:invoiceId', element: <InvoiceDetail /> }`. The badge hook goes in **`ParentShell`**, never in `Shell` — `Shell` returns early on three statuses, and a hook after an early return breaks the Rules of Hooks:
```tsx
import { usePendingCount } from './screens/Inbox.js';

function ParentShell() {
  // safe here: ParentShell only ever renders when status === 'ready',
  // so this hook runs on every one of its renders
  const pending = usePendingCount();
  return (
    <>
      <main>
        <Routes>
          {parentRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
          <Route path="*" element={<Navigate to={PARENT_TABS[0].to} replace />} />
        </Routes>
      </main>
      <BottomTabs
        tabs={PARENT_TABS.map((tab) => (
          tab.to === '/inbox' ? { ...tab, badge: pending } : { ...tab }
        ))}
      />
    </>
  );
}
```

- [ ] **Step 7: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS. If a return or counter fails with `permission-denied`, compare the batch against the event shape in Global Constraints — the usual causes are a missing `kidId`, a client-side `Date` instead of `serverTimestamp()`, or `eventCount` not incremented by exactly 1.

- [ ] **Step 8: Commit**

```bash
git add app firestore.indexes.json
git commit -m "feat(app): invoice inbox and the approve/counter/return review flow"
```

---

### Task 12: Payouts and balances

**Files:**
- Create: `app/src/screens/Payouts.tsx`, `app/src/screens/Payouts.test.tsx`
- Modify: `app/src/routes.tsx`, `firestore.indexes.json`, `app/src/i18n/*.json`

**Interfaces:**
- Consumes: `recordPayout` callable; `useCollection`.
- Produces: `<Payouts />` at `/payouts`. Each payout generates a fresh `requestId` via `crypto.randomUUID()` and **keeps it for retries** — the callable is idempotent on the full payload, so a retry with the same id is a safe no-op while a new id would double-pay.

- [ ] **Step 1: Write the failing tests**

`app/src/screens/Payouts.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, signInTestParent } from '../test/emulator.js';
import { SessionProvider } from '../session/SessionContext.js';
import { Payouts } from './Payouts.js';

const familyId = 'famP';

beforeAll(async () => { await initI18n('es'); });

beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('payparent');
  const uid = auth.currentUser!.uid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(db, `families/${familyId}/members`, uid), { role: 'parent', displayName: 'Leo' });
  batch.set(doc(db, 'parentIndex', uid), { familyId });
  await batch.commit();
  await setDoc(doc(db, `families/${familyId}/kids/k1`), {
    name: 'Mia', birthYear: 2016, deductionsEnabled: true,
    spendableBalance: 7000, savingsBalance: 2000,
  });
});

function renderScreen() {
  return render(<SessionProvider><Payouts /></SessionProvider>);
}

describe('Payouts', () => {
  it('records a payout through the callable and debits the balance', async () => {
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    await userEvent.type(within(card).getByLabelText(/monto/i), '3000');
    await userEvent.click(within(card).getByRole('button', { name: /registrar pago/i }));
    await waitFor(async () => {
      expect((await getDoc(doc(db, `families/${familyId}/kids/k1`))).get('spendableBalance')).toBe(4000);
    });
    const ledger = await getDocs(collection(db, `families/${familyId}/ledger`));
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0].get('type')).toBe('payout');
    expect(ledger.docs[0].get('balance')).toBe('spendable');
  });

  it('pays out of savings when that balance is chosen', async () => {
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    await userEvent.selectOptions(within(card).getByLabelText(/de dónde/i), 'savings');
    await userEvent.type(within(card).getByLabelText(/monto/i), '2000');
    await userEvent.click(within(card).getByRole('button', { name: /registrar pago/i }));
    await waitFor(async () => {
      expect((await getDoc(doc(db, `families/${familyId}/kids/k1`))).get('savingsBalance')).toBe(0);
    });
  });

  it('shows the callable error when the payout exceeds the balance', async () => {
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    await userEvent.type(within(card).getByLabelText(/monto/i), '9999');
    await userEvent.click(within(card).getByRole('button', { name: /registrar pago/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect((await getDoc(doc(db, `families/${familyId}/kids/k1`))).get('spendableBalance')).toBe(7000);
  });

  it('rejects an unparseable amount without calling the function', async () => {
    renderScreen();
    const card = await screen.findByRole('group', { name: /Mia/ });
    await userEvent.type(within(card).getByLabelText(/monto/i), 'abc');
    await userEvent.click(within(card).getByRole('button', { name: /registrar pago/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect((await getDocs(collection(db, `families/${familyId}/ledger`))).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npm run test:app` → FAIL (no `Payouts.js`).

Add to `firestore.indexes.json` (`indexes` array) for the per-kid ledger history:
```json
    {
      "collectionGroup": "ledger",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "kidId", "order": "ASCENDING" },
        { "fieldPath": "at", "order": "DESCENDING" }
      ]
    }
```

Add to `es.json` (mirror in `en.json`):
```json
  "payouts": {
    "title": "Pagos",
    "amount": "Monto a pagar",
    "from": "De dónde sale",
    "note": "Nota (opcional)",
    "submit": "Registrar pago",
    "history": "Movimientos",
    "badAmount": "Escribe un monto válido.",
    "types": { "credit": "Factura aprobada", "savings-credit": "A ahorro", "payout": "Pago" }
  }
```
(`en`: `"title": "Payouts", "amount": "Amount to pay", "from": "Paid from", "note": "Note (optional)", "submit": "Record payout", "history": "History", "badAmount": "Enter a valid amount.", "types": { "credit": "Approved invoice", "savings-credit": "To savings", "payout": "Payout" }`)

`app/src/screens/Payouts.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { parseMajor } from '@money-kids/shared';
import { db } from '../firebase.js';
import { useCollection } from '../hooks/useCollection.js';
import { useSession } from '../session/SessionContext.js';
import { recordPayout } from '../lib/callables.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { Money } from '../components/Money.js';
import styles from './Kids.module.css';

interface Kid {
  id: string; name: string;
  spendableBalance: number; savingsBalance: number;
}

interface LedgerEntry {
  id: string; kidId: string;
  type: 'credit' | 'savings-credit' | 'payout';
  balance: 'spendable' | 'savings';
  amount: number; note?: string;
}

function KidPayout({ familyId, kid }: { familyId: string; kid: Kid }) {
  const { t } = useTranslation();
  const { family } = useSession();
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState<'spendable' | 'savings'>('spendable');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // held across retries: the callable is idempotent per requestId, so reusing
  // it makes a retry safe while a fresh one would pay twice
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const history = useCollection<LedgerEntry>(
    query(
      collection(db, `families/${familyId}/ledger`),
      where('kidId', '==', kid.id),
      orderBy('at', 'desc'),
      limit(10),
    ),
  );

  async function pay() {
    let minor: number;
    try {
      minor = parseMajor(amount.replace(/[^\d.,]/g, ''), family!.currency);
    } catch {
      setError(t('payouts.badAmount'));
      return;
    }
    if (minor <= 0) {
      setError(t('payouts.badAmount'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordPayout({ familyId, kidId: kid.id, balance, amount: minor, note, requestId });
      setAmount('');
      setNote('');
      setRequestId(crypto.randomUUID()); // only after a confirmed success
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card label={kid.name}>
      <h2>{kid.name}</h2>
      <p>
        {t('money.spendable')}: <Money amount={kid.spendableBalance} />
        {' · '}
        {t('money.savings')}: <Money amount={kid.savingsBalance} />
      </p>
      {error && <ErrorBanner message={error} />}

      <label htmlFor={`from-${kid.id}`}>{t('payouts.from')}</label>
      <select
        id={`from-${kid.id}`} value={balance}
        onChange={(e) => setBalance(e.target.value as 'spendable' | 'savings')}
      >
        <option value="spendable">{t('money.spendable')}</option>
        <option value="savings">{t('money.savings')}</option>
      </select>

      <label htmlFor={`amount-${kid.id}`}>{t('payouts.amount')}</label>
      <input
        id={`amount-${kid.id}`} inputMode="decimal" value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <label htmlFor={`note-${kid.id}`}>{t('payouts.note')}</label>
      <input
        id={`note-${kid.id}`} value={note} maxLength={500}
        onChange={(e) => setNote(e.target.value)}
      />

      <Button disabled={busy} onClick={pay}>{t('payouts.submit')}</Button>

      <h3>{t('payouts.history')}</h3>
      <ul>
        {history.docs.map((entry) => (
          <li key={entry.id}>
            {t(`payouts.types.${entry.type}`)}{' '}
            {entry.type === 'payout' ? '−' : '+'}
            <Money amount={entry.amount} />
            {entry.note ? ` — ${entry.note}` : ''}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Payouts() {
  const { t } = useTranslation();
  const { familyId } = useSession();
  const kids = useCollection<Kid>(familyId ? query(collection(db, `families/${familyId}/kids`)) : null);

  return (
    <div className={styles.screen}>
      <h1>{t('payouts.title')}</h1>
      {kids.docs.map((kid) => <KidPayout key={kid.id} familyId={familyId!} kid={kid} />)}
    </div>
  );
}
```

Register the route: `{ to: '/payouts', labelKey: 'nav.payouts' }` in `PARENT_TABS`, `{ path: '/payouts', element: <Payouts /> }` in `parentRoutes`.

- [ ] **Step 3: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add app firestore.indexes.json
git commit -m "feat(app): payout recording with idempotent request ids"
```

---

### Task 13: Deduction settings

**Files:**
- Create: `app/src/screens/DeductionSettings.tsx`, `app/src/screens/DeductionSettings.test.tsx`
- Modify: `app/src/screens/Settings.tsx`, `app/src/i18n/*.json`

**Interfaces:**
- Consumes: `setDeductionRules` callable; `validateDeductionRules` from `@money-kids/shared` (client-side pre-check so the parent sees the error before a round trip); `DeductionRule`.
- Produces: `<DeductionSettings />`, rendered as a section inside `<Settings />`. Deductions are **off by default** (an empty rule array) with a one-tap starter preset "Ahorro 20% + Impuesto familiar 10%", exactly as the spec describes.

- [ ] **Step 1: Write the failing tests**

`app/src/screens/DeductionSettings.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { initI18n } from '../i18n/index.js';
import { clearFirestoreData, signInTestParent } from '../test/emulator.js';
import { SessionProvider } from '../session/SessionContext.js';
import { DeductionSettings } from './DeductionSettings.js';

const familyId = 'famD';

beforeAll(async () => { await initI18n('es'); });

beforeEach(async () => {
  await clearFirestoreData();
  await signInTestParent('dedparent');
  const uid = auth.currentUser!.uid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', familyId), {
    name: 'T', language: 'es', currency: 'COP', createdBy: uid, deductionRules: [],
  });
  batch.set(doc(db, `families/${familyId}/members`, uid), { role: 'parent', displayName: 'Leo' });
  batch.set(doc(db, 'parentIndex', uid), { familyId });
  await batch.commit();
});

function renderScreen() {
  return render(<SessionProvider><DeductionSettings /></SessionProvider>);
}

describe('DeductionSettings', () => {
  it('applies the starter preset through the callable', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /preset|paquete inicial/i }));
    await waitFor(async () => {
      const rules = (await getDoc(doc(db, 'families', familyId))).get('deductionRules');
      expect(rules).toHaveLength(2);
      expect(rules[0]).toMatchObject({ basisPoints: 2000, destination: 'savings' });
      expect(rules[1]).toMatchObject({ basisPoints: 1000, destination: 'withheld' });
    });
  });

  it('adds a custom rule in percent and stores basis points', async () => {
    renderScreen();
    await userEvent.type(await screen.findByLabelText(/nombre en español/i), 'Fondo');
    await userEvent.type(screen.getByLabelText(/nombre en inglés/i), 'Fund');
    await userEvent.type(screen.getByLabelText(/porcentaje/i), '7.5');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(async () => {
      const rules = (await getDoc(doc(db, 'families', familyId))).get('deductionRules');
      // 7.5% is 750 basis points, not 7.5 and not 75
      expect(rules).toEqual([
        { nameEs: 'Fondo', nameEn: 'Fund', basisPoints: 750, destination: 'savings' },
      ]);
    });
  });

  it('refuses a set of rules that would sum above 100% before calling', async () => {
    renderScreen();
    await userEvent.type(await screen.findByLabelText(/nombre en español/i), 'Todo');
    await userEvent.type(screen.getByLabelText(/nombre en inglés/i), 'All');
    await userEvent.type(screen.getByLabelText(/porcentaje/i), '150');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect((await getDoc(doc(db, 'families', familyId))).get('deductionRules')).toEqual([]);
  });

  it('removes a rule, and clearing all rules turns deductions off', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /preset|paquete inicial/i }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /quitar/i })).toHaveLength(2));
    // re-query between clicks: the list re-renders, so a node captured up
    // front is detached by the time the second click lands
    await userEvent.click(screen.getAllByRole('button', { name: /quitar/i })[0]!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /quitar/i })).toHaveLength(1));
    await userEvent.click(screen.getAllByRole('button', { name: /quitar/i })[0]!);
    await waitFor(async () => {
      expect((await getDoc(doc(db, 'families', familyId))).get('deductionRules')).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npm run test:app` → FAIL (no `DeductionSettings.js`).

Add to `es.json` (mirror in `en.json`):
```json
  "deductions": {
    "title": "Deducciones",
    "help": "Se aplican cuando apruebas una factura. Se pueden apagar por niño.",
    "preset": "Usar el paquete inicial (Ahorro 20% + Impuesto familiar 10%)",
    "nameEs": "Nombre en español",
    "nameEn": "Nombre en inglés",
    "percent": "Porcentaje",
    "destination": "A dónde va",
    "toSavings": "Al ahorro del niño",
    "withheld": "Se retiene",
    "remove": "Quitar",
    "off": "Las deducciones están apagadas.",
    "badPercent": "El porcentaje debe estar entre 0 y 100, con máximo dos decimales.",
    "tooMuch": "La suma de las deducciones no puede pasar de 100%."
  }
```
(`en`: `"title": "Deductions", "help": "Applied when you approve an invoice. Can be switched off per kid.", "preset": "Use the starter preset (Savings 20% + Family tax 10%)", "nameEs": "Spanish name", "nameEn": "English name", "percent": "Percent", "destination": "Where it goes", "toSavings": "To the kid's savings", "withheld": "Withheld", "remove": "Remove", "off": "Deductions are off.", "badPercent": "The percent must be between 0 and 100, with at most two decimals.", "tooMuch": "Deductions cannot add up to more than 100%."`)

`app/src/screens/DeductionSettings.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validateDeductionRules, type DeductionRule, type Destination } from '@money-kids/shared';
import { useSession } from '../session/SessionContext.js';
import { setDeductionRules } from '../lib/callables.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { ErrorBanner } from '../components/ErrorBanner.js';

const STARTER_PRESET: DeductionRule[] = [
  { nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000, destination: 'savings' },
  { nameEs: 'Impuesto familiar', nameEn: 'Family tax', basisPoints: 1000, destination: 'withheld' },
];

/** '7.5' -> 750 basis points. Percent input, basis-point storage. */
function percentToBasisPoints(text: string): number {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text.trim())) throw new Error('bad percent');
  const bp = Math.round(Number(text.trim()) * 100);
  if (bp < 0 || bp > 10000) throw new Error('bad percent');
  return bp;
}

export function DeductionSettings() {
  const { t } = useTranslation();
  const { familyId, family } = useSession();
  const rules = family?.deductionRules ?? [];
  const [nameEs, setNameEs] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [percent, setPercent] = useState('');
  const [destination, setDestination] = useState<Destination>('savings');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: DeductionRule[]) {
    setBusy(true);
    setError(null);
    try {
      // the same validator the callable runs, so the parent sees the problem
      // without a round trip; the server still re-validates
      validateDeductionRules(next);
      await setDeductionRules({ familyId: familyId!, rules: next });
    } catch (e) {
      setError(/sum|exceed/i.test((e as Error).message) ? t('deductions.tooMuch') : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    let basisPoints: number;
    try {
      basisPoints = percentToBasisPoints(percent);
    } catch {
      setError(t('deductions.badPercent'));
      return;
    }
    if (nameEs.trim() === '' || nameEn.trim() === '') {
      setError(t('common.error'));
      return;
    }
    const next = [...rules, {
      nameEs: nameEs.trim(), nameEn: nameEn.trim(), basisPoints, destination,
    }];
    const total = next.reduce((sum, r) => sum + r.basisPoints, 0);
    if (total > 10000) {
      setError(t('deductions.tooMuch'));
      return;
    }
    await save(next);
    setNameEs('');
    setNameEn('');
    setPercent('');
  }

  return (
    <Card label={t('deductions.title')}>
      <h2>{t('deductions.title')}</h2>
      <p><small>{t('deductions.help')}</small></p>
      {error && <ErrorBanner message={error} />}

      {rules.length === 0 && (
        <>
          <p>{t('deductions.off')}</p>
          <Button disabled={busy} onClick={() => save(STARTER_PRESET)}>
            {t('deductions.preset')}
          </Button>
        </>
      )}

      <ul>
        {rules.map((rule, index) => (
          <li key={`${rule.nameEn}-${rule.basisPoints}`}>
            {rule.nameEs} / {rule.nameEn} — {(rule.basisPoints / 100).toFixed(2)}%
            {' · '}
            {rule.destination === 'savings' ? t('deductions.toSavings') : t('deductions.withheld')}
            {' '}
            <Button
              variant="danger" disabled={busy}
              onClick={() => save(rules.filter((_, i) => i !== index))}
            >
              {t('deductions.remove')}
            </Button>
          </li>
        ))}
      </ul>

      <label htmlFor="ded-es">{t('deductions.nameEs')}</label>
      <input id="ded-es" value={nameEs} maxLength={60} onChange={(e) => setNameEs(e.target.value)} />
      <label htmlFor="ded-en">{t('deductions.nameEn')}</label>
      <input id="ded-en" value={nameEn} maxLength={60} onChange={(e) => setNameEn(e.target.value)} />
      <label htmlFor="ded-pct">{t('deductions.percent')}</label>
      <input
        id="ded-pct" inputMode="decimal" value={percent}
        onChange={(e) => setPercent(e.target.value)}
      />
      <label htmlFor="ded-dest">{t('deductions.destination')}</label>
      <select
        id="ded-dest" value={destination}
        onChange={(e) => setDestination(e.target.value as Destination)}
      >
        <option value="savings">{t('deductions.toSavings')}</option>
        <option value="withheld">{t('deductions.withheld')}</option>
      </select>
      <Button disabled={busy} onClick={add}>{t('common.save')}</Button>
    </Card>
  );
}
```

Render it inside `Settings.tsx` (import and place `<DeductionSettings />` above the invites card).

- [ ] **Step 3: Verify**

Run: `npm run test:app && npm run typecheck -w @money-kids/app`
Expected: all PASS. Note the rules on `families/{familyId}` **deny** client writes to `deductionRules`, so a direct `updateDoc` here would fail — the callable is the only path, and that is deliberate.

- [ ] **Step 4: Commit**

```bash
git add app
git commit -m "feat(app): deduction rule settings with the starter preset"
```

---

### Task 14: Parent PIN lock

**Scope note from the spec:** the PIN is "a UI convenience lock against casual misuse, not a backend authorization boundary" — the parent's Firebase session stays active on the device. Do not present it as security in the UI copy, and do not add any rule or callable that trusts it. Plan 3's kid view calls `lockParentView()` when a kid takes the device.

**Files:**
- Create: `app/src/lib/pin.ts`, `app/src/lib/pin.test.ts`, `app/src/components/PinGate.tsx`, `app/src/components/PinGate.test.tsx`
- Modify: `app/src/App.tsx`, `app/src/screens/Settings.tsx`, `app/src/i18n/*.json`

**Interfaces:**
- Produces:
  - `setPin(pin: string): void` — stores a salted SHA-256 digest in `localStorage`, never the PIN itself
  - `hasPin(): boolean`, `verifyPin(pin: string): Promise<boolean>`, `clearPin(): void`
  - `lockParentView(): void`, `isParentViewLocked(): boolean`, `unlockParentView(pin: string): Promise<boolean>`
  - `<PinGate>` — wraps the parent shell and shows a PIN prompt while locked

- [ ] **Step 1: Write the failing tests**

`app/src/lib/pin.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setPin, hasPin, verifyPin, clearPin,
  lockParentView, isParentViewLocked, unlockParentView,
} from './pin.js';

beforeEach(() => { localStorage.clear(); });

describe('pin storage', () => {
  it('stores a digest, never the PIN itself', async () => {
    await setPin('1234');
    expect(hasPin()).toBe(true);
    const dump = JSON.stringify(localStorage);
    expect(dump).not.toContain('1234');
    expect(await verifyPin('1234')).toBe(true);
    expect(await verifyPin('9999')).toBe(false);
  });
  it('reports no pin before one is set, and after clearing', async () => {
    expect(hasPin()).toBe(false);
    await setPin('1234');
    clearPin();
    expect(hasPin()).toBe(false);
  });
  it('rejects PINs that are not four to eight digits', async () => {
    await expect(setPin('12')).rejects.toThrow(/pin/i);
    await expect(setPin('abcd')).rejects.toThrow(/pin/i);
    await expect(setPin('123456789')).rejects.toThrow(/pin/i);
  });
});

describe('parent view lock', () => {
  it('unlocks only with the right pin', async () => {
    await setPin('4321');
    lockParentView();
    expect(isParentViewLocked()).toBe(true);
    expect(await unlockParentView('0000')).toBe(false);
    expect(isParentViewLocked()).toBe(true);
    expect(await unlockParentView('4321')).toBe(true);
    expect(isParentViewLocked()).toBe(false);
  });
  it('cannot be locked when no pin is set — that would strand the parent', async () => {
    lockParentView();
    expect(isParentViewLocked()).toBe(false);
  });
});
```

`app/src/components/PinGate.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n/index.js';
import { setPin, lockParentView } from '../lib/pin.js';
import { PinGate } from './PinGate.js';

beforeAll(async () => { await initI18n('es'); });
beforeEach(() => { localStorage.clear(); });

describe('PinGate', () => {
  it('passes children through when unlocked', () => {
    render(<PinGate><p>secreto</p></PinGate>);
    expect(screen.getByText('secreto')).toBeInTheDocument();
  });
  it('hides children while locked and reveals them on the right pin', async () => {
    await setPin('1234');
    lockParentView();
    render(<PinGate><p>secreto</p></PinGate>);
    expect(screen.queryByText('secreto')).toBeNull();
    await userEvent.type(screen.getByLabelText(/pin/i), '9999');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('secreto')).toBeNull();
    await userEvent.clear(screen.getByLabelText(/pin/i));
    await userEvent.type(screen.getByLabelText(/pin/i), '1234');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    await waitFor(() => expect(screen.getByText('secreto')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify they fail, then implement**

Run: `npm run test:app` → FAIL (no `pin.js`).

Add to `es.json` (mirror in `en.json`):
```json
  "pin": {
    "title": "PIN de adulto",
    "help": "Sirve para que el niño no entre por accidente a la vista de adulto. No es una contraseña de seguridad.",
    "set": "Guardar PIN",
    "clear": "Quitar PIN",
    "enter": "Escribe el PIN",
    "submit": "Entrar",
    "wrong": "Ese PIN no es correcto.",
    "invalid": "El PIN debe tener entre 4 y 8 números.",
    "lock": "Bloquear vista de adulto"
  }
```
(`en`: `"title": "Adult PIN", "help": "Keeps a kid from wandering into the adult view by accident. It is not a security password.", "set": "Save PIN", "clear": "Remove PIN", "enter": "Enter the PIN", "submit": "Enter", "wrong": "That PIN is not correct.", "invalid": "The PIN must be 4 to 8 digits.", "lock": "Lock the adult view"`)

`app/src/lib/pin.ts`:
```ts
const DIGEST_KEY = 'mk.pin.digest';
const SALT_KEY = 'mk.pin.salt';
const LOCK_KEY = 'mk.pin.locked';

async function digest(pin: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Device-local convenience lock. The digest is stored, never the PIN — but
 * this is not a security boundary: the parent's Firebase session stays live
 * on the device, exactly as the spec's threat model states.
 */
export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('pin must be 4 to 8 digits');
  const salt = crypto.randomUUID();
  localStorage.setItem(SALT_KEY, salt);
  localStorage.setItem(DIGEST_KEY, await digest(pin, salt));
}

export function hasPin(): boolean {
  return localStorage.getItem(DIGEST_KEY) !== null;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(DIGEST_KEY);
  const salt = localStorage.getItem(SALT_KEY);
  if (stored === null || salt === null) return false;
  return (await digest(pin, salt)) === stored;
}

export function clearPin(): void {
  localStorage.removeItem(DIGEST_KEY);
  localStorage.removeItem(SALT_KEY);
  localStorage.removeItem(LOCK_KEY);
}

export function lockParentView(): void {
  // locking with no PIN set would strand the parent with no way back in
  if (!hasPin()) return;
  localStorage.setItem(LOCK_KEY, '1');
}

export function isParentViewLocked(): boolean {
  return hasPin() && localStorage.getItem(LOCK_KEY) === '1';
}

export async function unlockParentView(pin: string): Promise<boolean> {
  if (!(await verifyPin(pin))) return false;
  localStorage.removeItem(LOCK_KEY);
  return true;
}
```

`app/src/components/PinGate.tsx`:
```tsx
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isParentViewLocked, unlockParentView } from '../lib/pin.js';
import { Button } from './Button.js';
import { ErrorBanner } from './ErrorBanner.js';

export function PinGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [locked, setLocked] = useState(() => isParentViewLocked());
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);

  if (!locked) return <>{children}</>;

  return (
    <main>
      <h1>{t('pin.title')}</h1>
      {wrong && <ErrorBanner message={t('pin.wrong')} />}
      <label htmlFor="pin-entry">{t('pin.enter')}</label>
      <input
        id="pin-entry" type="password" inputMode="numeric" value={pin}
        onChange={(e) => setPin(e.target.value)}
      />
      <Button
        onClick={async () => {
          if (await unlockParentView(pin)) {
            setLocked(false);
            setWrong(false);
          } else {
            setWrong(true);
          }
        }}
      >
        {t('pin.submit')}
      </Button>
    </main>
  );
}
```

Wrap the parent shell in `App.tsx` (`<PinGate>` around the routed `<main>` and `<BottomTabs>`), and add a PIN section to `Settings.tsx` with a set/clear input and a `lockParentView()` button using the `pin.*` keys.

- [ ] **Step 3: Verify the whole plan**

Run every suite, as the final gate:
```bash
npm run typecheck
npm test -w @money-kids/shared
npm run test:rules
npm run test:functions
npm run test:app
npm run build:app
npm run build -w @money-kids/functions
```
Expected: everything PASSES, no type errors in any workspace, both bundles build.

- [ ] **Step 4: Commit**

```bash
git add app
git commit -m "feat(app): device-local parent PIN lock for the profile switcher"
```

---

## What comes after this plan

- **Plan 3 — Kid experience & polish:** kid join flow redeeming the code minted here (`mintKidToken`), the invoice builder with client-side photo compression and draft-first uploads, counter-offer acceptance via `acceptCounterOffer`, age-mode presets as `tokens.css` overrides, the balance and pay-stub views, the QR rendering of join codes alongside the kid-side scanner that gives it a purpose, PWA install and offline persistence, and the Playwright mobile-viewport e2e run covering sign-up → add kid → kid invoices with a photo → parent approves → balance updates → payout.

## Deliberate gaps in this plan

Stated so a reviewer does not read them as oversights:

- **Google sign-in has no automated test.** `signInWithPopup` needs a real browser popup; Plan 3's Playwright pass covers it.
- **The invite happy path is tested at the function level, not through the UI.** Minting an invite and redeeming it needs two signed-in identities in one test process; the callable tests cover both sides, and the UI test covers the visible-failure path.
- **Photo *upload* is not in this plan.** Parents only read photos; kids attach them, which is Plan 3 under the Storage rules Plan 1 shipped.
- **No push notifications.** The spec puts them out of scope for v1; the tab badge is the notification.
- **`inviteLog` shows raw uids** rather than display names. Resolving them needs a members read per row; Plan 3 can join against the members collection when the parent list UI arrives.
