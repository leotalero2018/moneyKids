# Money Kids — Plan 1: Foundation & Money Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-authoritative money core of Money Kids: shared domain logic (deduction math, invoice state machine), Firestore/Storage security rules, and the callable Cloud Functions — all emulator-tested.

**Architecture:** npm-workspaces monorepo. `packages/shared` holds pure domain logic used by both functions and (later) the app. `functions/` holds callable Cloud Functions bundled with esbuild so the deploy artifact is self-contained. `packages/rules-tests` tests `firestore.rules`/`storage.rules` against the Firebase emulators. No frontend in this plan (Plans 2–3).

**Tech Stack:** TypeScript (strict), Node 20, npm workspaces, Vitest, Firebase (Firestore, Auth, Storage, Cloud Functions v2), `@firebase/rules-unit-testing`, `firebase-admin`, esbuild.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-money-kids-design.md`. Every invariant below is copied from it.
- All money amounts are **integers in minor units**; deduction rules use integer `basisPoints`, each `>= 0`, sum `<= 10000`.
- Invoice statuses: `draft | sent | approved | countered | returned`. Ledger types: `credit | savings-credit | payout`; every ledger entry has `balance: 'spendable' | 'savings'`; amounts always positive.
- Deterministic ledger IDs, create-only: `credit_{invoiceId}`, `savings_{invoiceId}`, `payout_{requestId}`.
- Kid auth: custom token, UID `kid_{familyId}_{kidId}` (family-namespaced — kid doc IDs are only unique within a family, and Auth UIDs are global), claims `{ familyId, kidId, role: 'kid' }`.
- Family `currency` immutable after creation; `deductionRules` writable only via callable.
- Kids may edit invoices only in statuses `draft | returned | countered`; only `draft` deletable; no client transition into `approved`.
- Events live in an `events` subcollection under each invoice, create-only, with deterministic IDs `e{N}` tied to the invoice's `eventCount` (starts 0, +1 per transition, transition and event created in one batch); `actorUid == request.auth.uid`, `at == request.time`; every `→ sent` event includes `requestedAmount`.
- Node ≥ 20.11 (`import.meta.dirname` needs 20.11; prefer `fileURLToPath(import.meta.url)` regardless), TypeScript `strict: true` everywhere. Run all emulator tests via `firebase emulators:exec`.
- **`strict` is only real if it is checked:** every workspace has a `typecheck` script (`tsc --noEmit`) and every task's verification step runs it — Vitest transpiles without typechecking and esbuild strips types.
- **Callable payloads are untrusted; authorization is not validation.** Every callable validates every payload field through `@money-kids/shared` validators *before* the value reaches a document path: IDs are `[A-Za-z0-9_-]{1,128}` (no `/`, no `.`/`..`), `requestId` is an opaque 8–64 char key, `note` is bounded, join codes must match the exact alphabet and length. Malformed-input tests accompany the authorization tests.
- **"Cross-family" means a real member of another family**, not an unaffiliated stranger UID: a stranger only exercises the membership lookup. Every callable has a test where a genuine parent of `fam2` targets `fam1`, and the mirror direction, asserting no balance moved.
- Photo count is capped at 8 per invoice, enforced on `photoPaths` in the Firestore invoice rules (Storage rules cannot count objects under a prefix). Storage writes additionally require the linked invoice's own `kidId` to equal the path's `{kidId}` segment — status alone would let a kid attach a sibling's invoice under their own prefix.
- A family can never be created without its founder's `members/{uid}` doc in the same batch (rule-enforced): every other rule authorizes through membership, so such a family would be permanently unreachable.
- Commit after every task (steps say when).

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `tsconfig.base.json`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/index.ts`, `packages/shared/src/index.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: workspace `@money-kids/shared` importable by later tasks; `npm test -w @money-kids/shared` runs Vitest.

- [ ] **Step 1: Write root workspace files**

`package.json`:
```json
{
  "name": "money-kids",
  "private": true,
  "engines": { "node": ">=20.11" },
  "workspaces": ["packages/*", "functions"],
  "scripts": {
    "test": "npm test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "declaration": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
*.log
.firebase/
firebase-debug.log
ui-debug.log
```

- [ ] **Step 2: Create the shared package with a sanity test**

`packages/shared/package.json`:
```json
{
  "name": "@money-kids/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
```

`packages/shared/src/index.ts`:
```ts
export const MINOR_UNIT_NOTE = 'all amounts are integers in minor units';
```

`packages/shared/src/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MINOR_UNIT_NOTE } from './index.js';

describe('workspace sanity', () => {
  it('imports the shared package', () => {
    expect(MINOR_UNIT_NOTE).toContain('minor units');
  });
});
```

- [ ] **Step 3: Install and run the test**

Run: `npm install && npm test -w @money-kids/shared && npm run typecheck -w @money-kids/shared`
Expected: 1 test passes; `tsc --noEmit` reports no errors.

**Every later task's verification step runs `npm run typecheck` for the workspace it touched, in addition to the tests** — Vitest transpiles without typechecking and esbuild strips types, so `strict: true` is otherwise never actually enforced.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold npm-workspaces monorepo with shared package"
```

---

### Task 2: Deduction math (`computeDeductions`) + callable input validators

**Files:**
- Create: `packages/shared/src/money.ts`, `packages/shared/src/validate.ts`
- Test: `packages/shared/src/money.test.ts`, `packages/shared/src/validate.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

**Interfaces:**
- Produces:
  - `type Destination = 'savings' | 'withheld'`
  - `interface DeductionRule { nameEs: string; nameEn: string; basisPoints: number; destination: Destination }`
  - `interface DeductionLine extends DeductionRule { amount: number }`
  - `interface DeductionBreakdown { gross: number; lines: DeductionLine[]; netAmount: number; savingsTotal: number; withheldTotal: number }`
  - `validateDeductionRules(rules: unknown): asserts rules is DeductionRule[]` — full runtime validation for untrusted callable input: must be an array of ≤ 20 objects, names 1–60 char strings, destination strictly `'savings' | 'withheld'`, basisPoints non-negative integers summing ≤ 10000; throws `Error` otherwise
  - `computeDeductions(gross: number, rules: DeductionRule[]): DeductionBreakdown` — throws on non-positive-integer gross
  - From `validate.ts` — **all callable payload fields are untrusted input; authorization is not validation.** IDs are interpolated into Firestore document paths, so an ID containing `/` re-points the path at a different document, and `requestId` additionally becomes part of a ledger doc ID:
    - `validateId(value: unknown, label: string): string` — non-empty string, ≤ 128 chars, matching `/^[A-Za-z0-9_-]+$/` (excludes `/`, `.`, and `..`); throws `Error` naming the field
    - `validateRequestId(value: unknown): string` — opaque client-supplied idempotency key: 8–64 chars, `/^[A-Za-z0-9_-]+$/`
    - `validateNote(value: unknown, max?: number): string` — string, default max 500 chars; accepts `''`
    - `validateJoinCode(value: unknown): string` — exactly 8 chars, all from the code alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
    - `validateBalance(value: unknown): 'spendable' | 'savings'`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/money.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeDeductions, validateDeductionRules, type DeductionRule } from './money.js';

const savings20: DeductionRule = { nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000, destination: 'savings' };
const tax10: DeductionRule = { nameEs: 'Impuesto familiar', nameEn: 'Family tax', basisPoints: 1000, destination: 'withheld' };

describe('validateDeductionRules', () => {
  it('accepts the starter preset', () => {
    expect(() => validateDeductionRules([savings20, tax10])).not.toThrow();
  });
  it('rejects negative basis points', () => {
    expect(() => validateDeductionRules([{ ...tax10, basisPoints: -1 }])).toThrow(/non-negative integer/);
  });
  it('rejects non-integer basis points', () => {
    expect(() => validateDeductionRules([{ ...tax10, basisPoints: 10.5 }])).toThrow(/non-negative integer/);
  });
  it('rejects sums above 100%', () => {
    expect(() => validateDeductionRules([savings20, { ...tax10, basisPoints: 8001 }])).toThrow(/exceed/);
  });
  it('accepts a sum of exactly 100%', () => {
    expect(() => validateDeductionRules([{ ...savings20, basisPoints: 10000 }])).not.toThrow();
  });
  it('rejects untrusted shapes at runtime (callable boundary)', () => {
    expect(() => validateDeductionRules('nope' as never)).toThrow(/array/);
    expect(() => validateDeductionRules([null as never])).toThrow(/object/);
    expect(() => validateDeductionRules([{ ...tax10, destination: 'pocket' as never }])).toThrow(/destination/);
    expect(() => validateDeductionRules([{ ...tax10, nameEs: '' }])).toThrow(/name/);
    expect(() => validateDeductionRules([{ ...tax10, nameEn: 'x'.repeat(61) }])).toThrow(/name/);
    expect(() => validateDeductionRules([{ ...tax10, basisPoints: '10' as never }])).toThrow(/non-negative integer/);
    expect(() => validateDeductionRules(new Array(21).fill(tax10))).toThrow(/too many/i);
  });
});

describe('computeDeductions', () => {
  it('computes the starter preset on a round amount', () => {
    const b = computeDeductions(10000, [savings20, tax10]);
    expect(b.lines.map((l) => l.amount)).toEqual([2000, 1000]);
    expect(b.savingsTotal).toBe(2000);
    expect(b.withheldTotal).toBe(1000);
    expect(b.netAmount).toBe(7000);
  });
  it('net + deductions always equals gross (rounding)', () => {
    // 3 rules that don't divide evenly: 33.33% x3 of 100
    const third: DeductionRule = { nameEs: 'A', nameEn: 'A', basisPoints: 3333, destination: 'withheld' };
    const b = computeDeductions(100, [third, third, third]);
    const total = b.lines.reduce((s, l) => s + l.amount, 0);
    expect(b.netAmount + total).toBe(100);
    // largest-remainder: floor(33.33)=33 each, target floor(99.99)=99 → no extra cent
    expect(b.lines.map((l) => l.amount)).toEqual([33, 33, 33]);
    expect(b.netAmount).toBe(1);
  });
  it('distributes remainder cents by largest fraction, ties by rule order', () => {
    const a: DeductionRule = { nameEs: 'a', nameEn: 'a', basisPoints: 2500, destination: 'withheld' };
    const b2: DeductionRule = { nameEs: 'b', nameEn: 'b', basisPoints: 2500, destination: 'withheld' };
    const r = computeDeductions(101, [a, b2]); // 25.25 each, target floor(50.5)=50
    expect(r.lines.map((l) => l.amount)).toEqual([25, 25]);
    expect(r.netAmount).toBe(51);
  });
  it('handles 100% deductions with zero net', () => {
    const b = computeDeductions(999, [{ ...savings20, basisPoints: 10000 }]);
    expect(b.netAmount).toBe(0);
    expect(b.savingsTotal).toBe(999);
  });
  it('returns empty breakdown for no rules', () => {
    const b = computeDeductions(500, []);
    expect(b.lines).toEqual([]);
    expect(b.netAmount).toBe(500);
  });
  it('rejects non-positive or fractional gross', () => {
    expect(() => computeDeductions(0, [])).toThrow(/positive integer/);
    expect(() => computeDeductions(10.5, [])).toThrow(/positive integer/);
  });
});
```

`packages/shared/src/validate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  validateId, validateRequestId, validateNote, validateJoinCode, validateBalance,
} from './validate.js';

describe('validateId', () => {
  it('accepts normal Firestore auto-IDs', () => {
    expect(validateId('kK9xZ2aBcDeF', 'invoiceId')).toBe('kK9xZ2aBcDeF');
    expect(validateId('fam1', 'familyId')).toBe('fam1');
  });
  it('rejects path traversal and separators — these are interpolated into doc paths', () => {
    expect(() => validateId('fam1/../fam2', 'familyId')).toThrow(/familyId/);
    expect(() => validateId('fam1/members/p1', 'familyId')).toThrow(/familyId/);
    expect(() => validateId('..', 'kidId')).toThrow(/kidId/);
    expect(() => validateId('.', 'kidId')).toThrow(/kidId/);
  });
  it('rejects empty, oversized, and non-string values', () => {
    expect(() => validateId('', 'kidId')).toThrow(/kidId/);
    expect(() => validateId('x'.repeat(129), 'kidId')).toThrow(/kidId/);
    expect(() => validateId(undefined, 'kidId')).toThrow(/kidId/);
    expect(() => validateId(42, 'kidId')).toThrow(/kidId/);
    expect(() => validateId({ toString: () => 'ok' }, 'kidId')).toThrow(/kidId/);
  });
});

describe('validateRequestId', () => {
  it('accepts a UUID and other opaque keys', () => {
    expect(validateRequestId('9f1c2b7e-3a44-4c9d-8f21-6b0d5e7a1c33')).toHaveLength(36);
    expect(validateRequestId('abc12345')).toBe('abc12345');
  });
  it('rejects too-short, too-long, and separator-bearing keys', () => {
    expect(() => validateRequestId('short')).toThrow(/requestId/);
    expect(() => validateRequestId('x'.repeat(65))).toThrow(/requestId/);
    expect(() => validateRequestId('r1/../credit_inv1')).toThrow(/requestId/);
  });
});

describe('validateNote', () => {
  it('accepts empty and bounded text', () => {
    expect(validateNote('')).toBe('');
    expect(validateNote('efectivo')).toBe('efectivo');
  });
  it('rejects overlong text and non-strings', () => {
    expect(() => validateNote('x'.repeat(501))).toThrow(/note/);
    expect(() => validateNote(null)).toThrow(/note/);
  });
});

describe('validateJoinCode', () => {
  it('accepts a well-formed code', () => {
    expect(validateJoinCode('ABCD2345')).toBe('ABCD2345');
  });
  it('rejects wrong length, lowercase, and excluded lookalike characters', () => {
    expect(() => validateJoinCode('ABC123')).toThrow(/code/i);
    expect(() => validateJoinCode('abcd2345')).toThrow(/code/i);
    expect(() => validateJoinCode('ABCD2340')).toThrow(/code/i); // 0 excluded
    expect(() => validateJoinCode('ABCD234I')).toThrow(/code/i); // I excluded
  });
});

describe('validateBalance', () => {
  it('accepts the two balances and rejects anything else', () => {
    expect(validateBalance('spendable')).toBe('spendable');
    expect(validateBalance('savings')).toBe('savings');
    expect(() => validateBalance('pocket')).toThrow(/balance/);
    expect(() => validateBalance(undefined)).toThrow(/balance/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @money-kids/shared`
Expected: FAIL — `money.js` module not found.

- [ ] **Step 3: Implement**

`packages/shared/src/money.ts`:
```ts
export type Destination = 'savings' | 'withheld';

export interface DeductionRule {
  nameEs: string;
  nameEn: string;
  basisPoints: number;
  destination: Destination;
}

export interface DeductionLine extends DeductionRule {
  amount: number;
}

export interface DeductionBreakdown {
  gross: number;
  lines: DeductionLine[];
  netAmount: number;
  savingsTotal: number;
  withheldTotal: number;
}

const MAX_RULES = 20;
const MAX_NAME_LENGTH = 60;

export function validateDeductionRules(rules: unknown): asserts rules is DeductionRule[] {
  if (!Array.isArray(rules)) throw new Error('deduction rules must be an array');
  if (rules.length > MAX_RULES) throw new Error(`too many deduction rules (max ${MAX_RULES})`);
  let sum = 0;
  for (const r of rules) {
    if (typeof r !== 'object' || r === null) throw new Error('each rule must be an object');
    const { nameEs, nameEn, basisPoints, destination } = r as Record<string, unknown>;
    for (const name of [nameEs, nameEn]) {
      if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LENGTH) {
        throw new Error(`rule names must be 1-${MAX_NAME_LENGTH} character strings`);
      }
    }
    if (destination !== 'savings' && destination !== 'withheld') {
      throw new Error("destination must be 'savings' or 'withheld'");
    }
    if (typeof basisPoints !== 'number' || !Number.isInteger(basisPoints) || basisPoints < 0) {
      throw new Error('basisPoints must be a non-negative integer');
    }
    sum += basisPoints;
  }
  if (sum > 10000) throw new Error('deduction rules exceed 100%');
}

export function computeDeductions(gross: number, rules: DeductionRule[]): DeductionBreakdown {
  if (!Number.isInteger(gross) || gross <= 0) throw new Error('gross must be a positive integer');
  validateDeductionRules(rules);
  const raw = rules.map((r) => (gross * r.basisPoints) / 10000);
  const amounts = raw.map(Math.floor);
  const totalBp = rules.reduce((s, r) => s + r.basisPoints, 0);
  let remainder = Math.floor((gross * totalBp) / 10000) - amounts.reduce((s, a) => s + a, 0);
  const byFraction = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byFraction) {
    if (remainder <= 0) break;
    amounts[i]! += 1;
    remainder -= 1;
  }
  const lines: DeductionLine[] = rules.map((r, i) => ({ ...r, amount: amounts[i]! }));
  const savingsTotal = lines.filter((l) => l.destination === 'savings').reduce((s, l) => s + l.amount, 0);
  const withheldTotal = lines.filter((l) => l.destination === 'withheld').reduce((s, l) => s + l.amount, 0);
  return { gross, lines, netAmount: gross - savingsTotal - withheldTotal, savingsTotal, withheldTotal };
}
```

`packages/shared/src/validate.ts`:
```ts
// Callable payloads are untrusted. These IDs are interpolated into Firestore
// document paths, so a value containing '/' would re-point the path at a
// different document; requestId also becomes part of a ledger document ID.
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_ID_LENGTH = 128;
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 8;

export function validateId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH
      || !ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a 1-${MAX_ID_LENGTH} character id of [A-Za-z0-9_-]`);
  }
  return value;
}

export function validateRequestId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 64
      || !ID_PATTERN.test(value)) {
    throw new Error('requestId must be an opaque 8-64 character key of [A-Za-z0-9_-]');
  }
  return value;
}

export function validateNote(value: unknown, max = 500): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`note must be a string of at most ${max} characters`);
  }
  return value;
}

export function validateJoinCode(value: unknown): string {
  if (typeof value !== 'string' || value.length !== JOIN_CODE_LENGTH
      || ![...value].every((c) => JOIN_CODE_ALPHABET.includes(c))) {
    throw new Error(`join code must be ${JOIN_CODE_LENGTH} characters from the code alphabet`);
  }
  return value;
}

export function validateBalance(value: unknown): 'spendable' | 'savings' {
  if (value !== 'spendable' && value !== 'savings') {
    throw new Error("balance must be 'spendable' or 'savings'");
  }
  return value;
}
```

Append to `packages/shared/src/index.ts`:
```ts
export * from './money.js';
export * from './validate.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @money-kids/shared && npm run typecheck -w @money-kids/shared`
Expected: all tests PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): deduction math with largest-remainder rounding; callable input validators"
```

---

### Task 3: Invoice state machine

**Files:**
- Create: `packages/shared/src/invoiceStatus.ts`
- Test: `packages/shared/src/invoiceStatus.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

**Interfaces:**
- Produces:
  - `type InvoiceStatus = 'draft' | 'sent' | 'approved' | 'countered' | 'returned'`
  - `type Actor = 'kid' | 'parent' | 'server'`
  - `canTransition(from: InvoiceStatus, to: InvoiceStatus, actor: Actor): boolean`
  - `const KID_EDITABLE: readonly InvoiceStatus[]` — `['draft', 'returned', 'countered']`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/invoiceStatus.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { canTransition, KID_EDITABLE } from './invoiceStatus.js';

describe('canTransition', () => {
  it.each([
    ['draft', 'sent', 'kid', true],
    ['sent', 'approved', 'server', true],
    ['sent', 'countered', 'parent', true],
    ['sent', 'returned', 'parent', true],
    ['returned', 'sent', 'kid', true],
    ['countered', 'approved', 'server', true],
    ['countered', 'sent', 'kid', true],
    // forbidden
    ['sent', 'approved', 'parent', false], // approval is server-only
    ['sent', 'approved', 'kid', false],
    ['draft', 'approved', 'server', false],
    ['approved', 'sent', 'kid', false], // approved is terminal
    ['approved', 'returned', 'parent', false],
    ['draft', 'sent', 'parent', false],
    ['sent', 'returned', 'kid', false],
  ] as const)('%s -> %s as %s = %s', (from, to, actor, ok) => {
    expect(canTransition(from, to, actor)).toBe(ok);
  });
});

describe('KID_EDITABLE', () => {
  it('is exactly draft, returned, countered', () => {
    expect([...KID_EDITABLE].sort()).toEqual(['countered', 'draft', 'returned']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @money-kids/shared`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/shared/src/invoiceStatus.ts`:
```ts
export type InvoiceStatus = 'draft' | 'sent' | 'approved' | 'countered' | 'returned';
export type Actor = 'kid' | 'parent' | 'server';

const TRANSITIONS: Record<string, readonly Actor[]> = {
  'draft->sent': ['kid'],
  'sent->approved': ['server'],
  'sent->countered': ['parent'],
  'sent->returned': ['parent'],
  'returned->sent': ['kid'],
  'countered->approved': ['server'],
  'countered->sent': ['kid'],
};

export const KID_EDITABLE: readonly InvoiceStatus[] = ['draft', 'returned', 'countered'];

export function canTransition(from: InvoiceStatus, to: InvoiceStatus, actor: Actor): boolean {
  return TRANSITIONS[`${from}->${to}`]?.includes(actor) ?? false;
}
```

Append to `packages/shared/src/index.ts`:
```ts
export * from './invoiceStatus.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @money-kids/shared`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): invoice status transition matrix"
```

---

### Task 4: Firebase emulator harness

**Files:**
- Create: `firebase.json`, `.firebaserc`, `firestore.rules` (deny-all skeleton), `firestore.indexes.json`, `storage.rules` (deny-all skeleton)
- Create: `packages/rules-tests/package.json`, `packages/rules-tests/vitest.config.ts`, `packages/rules-tests/src/helpers.ts`, `packages/rules-tests/src/smoke.test.ts`

**Interfaces:**
- Produces:
  - `npm run test:rules` (root) — runs rules tests inside `firebase emulators:exec`
  - `helpers.ts` exports: `setupTestEnv(): Promise<RulesTestEnvironment>` (project `money-kids-test`, loads `firestore.rules`), `parentCtx(env, uid)` (authenticated parent context), `kidCtx(env, familyId, kidId)` (authenticated kid context with `{ role: 'kid', familyId, kidId }` claims and uid `kid_{familyId}_{kidId}`), `seed(env, fn)` (wrapper around `withSecurityRulesDisabled`).

- [ ] **Step 1: Install Firebase tooling**

Create `packages/rules-tests/package.json` (below), then run `npm install -D firebase-tools` at the repo root (root devDependency, no `-w` flag) followed by `npm install` to wire the new workspace.

`packages/rules-tests/package.json`:
```json
{
  "name": "@money-kids/rules-tests",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "devDependencies": {
    "@firebase/rules-unit-testing": "^3.0.0",
    "firebase": "^10.12.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`packages/rules-tests/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], fileParallelism: false, testTimeout: 15000 },
});
```

- [ ] **Step 2: Write Firebase config with deny-all rules**

`firebase.json`:
```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" },
  "emulators": {
    "firestore": { "port": 8480 },
    "auth": { "port": 9099 },
    "storage": { "port": 9199 },
    "functions": { "port": 5001 },
    "ui": { "enabled": false }
  }
}
```

`.firebaserc`:
```json
{ "projects": { "default": "money-kids-dev" } }
```

`firestore.rules`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

`firestore.indexes.json`:
```json
{ "indexes": [], "fieldOverrides": [] }
```

`storage.rules`:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

Add to root `package.json` scripts:
```json
"test:rules": "firebase emulators:exec --only firestore,storage --project money-kids-test \"npm test -w @money-kids/rules-tests\""
```

- [ ] **Step 3: Write helpers and a failing smoke test**

`packages/rules-tests/src/helpers.ts`:
```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing';

// fileURLToPath, not import.meta.dirname: the latter only exists on Node >= 20.11,
// and this must not depend on the runner's patch version.
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
```

`packages/rules-tests/src/smoke.test.ts`:
```ts
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
```

- [ ] **Step 4: Run and verify green**

Run: `npm install && npm run test:rules`
Expected: emulators start, 1 test passes, emulators stop.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: firebase emulator harness with deny-all rules and test helpers"
```

---

### Task 5: Firestore rules — family, members, kids

**Files:**
- Modify: `firestore.rules` (replace deny-all with real rules; keep final catch-all deny)
- Test: `packages/rules-tests/src/family.test.ts`

**Interfaces:**
- Consumes: helpers from Task 4.
- Produces: rule functions `isFamilyParent()`, `isFamilyKid()`, `authKidId()` used by Tasks 6–8. Document shapes:
  - `families/{familyId}`: `{ name, language, currency, createdBy, deductionRules }`
  - `families/{familyId}/members/{uid}`: `{ role: 'parent', displayName }`
  - `families/{familyId}/kids/{kidId}`: `{ name, birthYear, deductionsEnabled, spendableBalance, savingsBalance }`

- [ ] **Step 1: Write the failing tests**

`packages/rules-tests/src/family.test.ts`:
```ts
import { describe, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { setupTestEnv, parentCtx, kidCtx, seed } from './helpers.js';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'families/fam1'), {
      name: 'Talero', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [],
    });
    await setDoc(doc(db, 'families/fam1/members/p1'), { role: 'parent', displayName: 'Leo' });
    await setDoc(doc(db, 'families/fam1/kids/k1'), {
      name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
    });
    await setDoc(doc(db, 'families/fam2'), {
      name: 'Other', language: 'en', currency: 'USD', createdBy: 'px', deductionRules: [],
    });
  });
});

describe('family isolation', () => {
  it('member parent reads own family; outsider parent cannot', async () => {
    await assertSucceeds(getDoc(doc(parentCtx(env, 'p1').firestore(), 'families/fam1')));
    await assertFails(getDoc(doc(parentCtx(env, 'p1').firestore(), 'families/fam2')));
  });
  it('kid reads own family doc but not another family', async () => {
    await assertSucceeds(getDoc(doc(kidCtx(env, 'fam1', 'k1').firestore(), 'families/fam1')));
    await assertFails(getDoc(doc(kidCtx(env, 'fam1', 'k1').firestore(), 'families/fam2')));
  });
});

describe('family creation and immutability', () => {
  it('a signed-in parent creates a family with themself as founder member (batch)', async () => {
    const db = parentCtx(env, 'p9').firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'families/fam9'), {
      name: 'New', language: 'en', currency: 'USD', createdBy: 'p9', deductionRules: [],
    });
    batch.set(doc(db, 'families/fam9/members/p9'), { role: 'parent', displayName: 'P9' });
    await assertSucceeds(batch.commit());
  });
  it('rejects a family created without the founder member doc (unreachable family)', async () => {
    const db = parentCtx(env, 'p9').firestore();
    // no member doc in the batch → family would be authorizable by nobody
    await assertFails(setDoc(doc(db, 'families/fam10'), {
      name: 'Orphan', language: 'en', currency: 'USD', createdBy: 'p9', deductionRules: [],
    }));
    // and a member doc for someone *else* does not satisfy it either
    const batch = writeBatch(db);
    batch.set(doc(db, 'families/fam11'), {
      name: 'Orphan2', language: 'en', currency: 'USD', createdBy: 'p9', deductionRules: [],
    });
    batch.set(doc(db, 'families/fam11/members/pOther'), { role: 'parent', displayName: 'Other' });
    await assertFails(batch.commit());
  });
  it('kid tokens cannot create families', async () => {
    const db = kidCtx(env, 'fam1', 'k1').firestore();
    await assertFails(setDoc(doc(db, 'families/fam8'), {
      name: 'X', language: 'en', currency: 'USD', createdBy: 'kid_fam1_k1', deductionRules: [],
    }));
  });
  it('currency is immutable, deductionRules not client-writable, name is editable', async () => {
    const db = parentCtx(env, 'p1').firestore();
    await assertFails(updateDoc(doc(db, 'families/fam1'), { currency: 'USD' }));
    await assertFails(updateDoc(doc(db, 'families/fam1'), { deductionRules: [{ nameEs: 'x', nameEn: 'x', basisPoints: 100, destination: 'withheld' }] }));
    await assertSucceeds(updateDoc(doc(db, 'families/fam1'), { name: 'Talero-Ruiz' }));
  });
});

describe('kids docs', () => {
  it('parent creates a kid with zero balances only', async () => {
    const db = parentCtx(env, 'p1').firestore();
    await assertSucceeds(setDoc(doc(db, 'families/fam1/kids/k2'), {
      name: 'Leo Jr', birthYear: 2019, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
    }));
    await assertFails(setDoc(doc(db, 'families/fam1/kids/k3'), {
      name: 'Rich', birthYear: 2019, deductionsEnabled: false, spendableBalance: 5000, savingsBalance: 0,
    }));
  });
  it('nobody client-side can touch balances; parent can edit other fields', async () => {
    const pdb = parentCtx(env, 'p1').firestore();
    await assertFails(updateDoc(doc(pdb, 'families/fam1/kids/k1'), { spendableBalance: 100 }));
    await assertFails(updateDoc(doc(pdb, 'families/fam1/kids/k1'), { savingsBalance: 100 }));
    await assertSucceeds(updateDoc(doc(pdb, 'families/fam1/kids/k1'), { deductionsEnabled: true }));
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertFails(updateDoc(doc(kdb, 'families/fam1/kids/k1'), { spendableBalance: 100 }));
  });
  it('kid reads own doc, not a sibling doc; kid docs are not deletable', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertSucceeds(getDoc(doc(kdb, 'families/fam1/kids/k1')));
    await seed(env, async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'families/fam1/kids/k2'), {
        name: 'Sib', birthYear: 2014, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0,
      });
    });
    await assertFails(getDoc(doc(kdb, 'families/fam1/kids/k2')));
    await assertFails(deleteDoc(doc(parentCtx(env, 'p1').firestore(), 'families/fam1/kids/k1')));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — all operations denied by deny-all rules (creation/read successes fail).

- [ ] **Step 3: Implement the rules**

Replace `firestore.rules` with:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isKidToken() { return signedIn() && request.auth.token.get('role', '') == 'kid'; }

    match /families/{familyId} {
      function isFamilyParent() {
        return signedIn() && !isKidToken()
          && exists(/databases/$(database)/documents/families/$(familyId)/members/$(request.auth.uid));
      }
      function isFamilyKid() {
        return isKidToken() && request.auth.token.familyId == familyId;
      }
      function authKidId() { return request.auth.token.kidId; }

      allow get: if isFamilyParent() || isFamilyKid();
      // the founder's member doc must be created in the same batch: a family
      // whose only parent is absent from members/ is permanently unreachable,
      // since every other rule authorizes through membership
      allow create: if signedIn() && !isKidToken()
        && request.resource.data.createdBy == request.auth.uid
        && request.resource.data.deductionRules == []
        && request.resource.data.currency is string
        && existsAfter(/databases/$(database)/documents/families/$(familyId)/members/$(request.auth.uid));
      allow update: if isFamilyParent()
        && !request.resource.data.diff(resource.data).affectedKeys()
             .hasAny(['currency', 'createdBy', 'deductionRules']);
      allow delete: if false;

      match /members/{memberId} {
        allow read: if isFamilyParent() || isFamilyKid();
        // founder creates their own member doc in the same batch as the family
        allow create: if signedIn() && !isKidToken()
          && memberId == request.auth.uid
          && request.resource.data.role == 'parent'
          && getAfter(/databases/$(database)/documents/families/$(familyId)).data.createdBy == request.auth.uid;
        allow update: if isFamilyParent() && memberId == request.auth.uid
          && request.resource.data.role == 'parent';
        allow delete: if false;
      }

      match /kids/{kidId} {
        allow get, list: if isFamilyParent() || (isFamilyKid() && kidId == authKidId());
        allow create: if isFamilyParent()
          && request.resource.data.spendableBalance == 0
          && request.resource.data.savingsBalance == 0;
        allow update: if isFamilyParent()
          && !request.resource.data.diff(resource.data).affectedKeys()
               .hasAny(['spendableBalance', 'savingsBalance']);
        allow delete: if false;
      }
    }
  }
}
```

Note: parent-invite acceptance (a second parent creating their own member doc from an invite) is Plan 2; this plan supports founder-only membership plus seeded members.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:rules`
Expected: all tests PASS (including the Task 4 smoke test, whose arbitrary path stays denied).

- [ ] **Step 5: Commit**

```bash
git add firestore.rules packages/rules-tests
git commit -m "feat(rules): family isolation, immutable currency, protected balances"
```

---

### Task 5.5: Spike — prove the event-sequence rule primitives execute

**Why this exists:** Task 6's event enforcement rests on two rules primitives whose behavior must be confirmed against the actual rules engine before building on them: a **computed path segment** inside `existsAfter`, and `getAfter`/`existsAfter` resolving *within a batch*. If either fails, the whole event-sequence design changes shape — so it is proven here, in isolation, in one short task rather than discovered mid-Task-6. Numbered 5.5 to keep Tasks 6–12 stable.

**Files:**
- Create: `packages/rules-tests/src/spike-eventseq.rules` (throwaway probe rules), `packages/rules-tests/src/spike-eventseq.test.ts`

**Interfaces:**
- Consumes: helpers from Task 4.
- Produces: a passing/failing answer that gates Task 6. This test **stays in the suite** as a regression canary on the primitives.

- [ ] **Step 1: Write the probe rules**

`packages/rules-tests/src/spike-eventseq.rules` — isolates the primitives from all other logic:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /target/{id} {
      allow get: if true;
      // computed path segment, exactly the Task 6 shape
      allow update: if existsAfter(/databases/$(database)/documents/probe/$('x' + string(request.resource.data.n)));
    }
    match /probe/{id} { allow read, write: if true; }
    match /{document=**} { allow read, write: if false; }
  }
}
```

- [ ] **Step 2: Write the spike test**

`packages/rules-tests/src/spike-eventseq.test.ts`:
```ts
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
```

- [ ] **Step 3: Run the spike**

Run: `npm run test:rules`
Expected: all three PASS. **Expected outcome is confirmation** — this design was verified against the emulator (firebase-tools + `@firebase/rules-unit-testing` v3, Firestore emulator) before the plan was finalized.

**If Step 3 fails**, stop and report before touching Task 6:
- *Compile failure in `beforeAll`* → computed segments are unsupported by this toolchain version. Fall back to a required `lastEventId` string field on the invoice (set to `'e' + eventCount`, validated on both the invoice and event rules, giving `existsAfter` a non-computed path via `$(newInv().lastEventId)`). Do **not** fall back to dropping event enforcement.
- *The "existing target" case denies* → `existsAfter` is not resolving in-batch; the transition+event pairing must then move server-side into a callable, which is a spec-level change (the spec currently has kids transitioning invoices client-side under rules) — escalate rather than improvise.

- [ ] **Step 4: Commit**

```bash
git add packages/rules-tests
git commit -m "test(rules): spike proving computed-path existsAfter executes for event sequencing"
```

---

### Task 6: Firestore rules — activities, invoices, events

**Files:**
- Modify: `firestore.rules` (add `activities`, `invoices`, `invoices/{id}/events` blocks inside the `families/{familyId}` match)
- Test: `packages/rules-tests/src/invoices.test.ts`

**Interfaces:**
- Consumes: rule helpers from Task 5.
- Produces: document shapes used by functions in Tasks 9–12:
  - `activities/{activityId}`: `{ titleEs, titleEn, descriptionEs, descriptionEn, suggestedPrice, category, repeatable, active }`
  - `invoices/{invoiceId}`: `{ kidId, activityId?, description, photoPaths, status, requestedAmount, eventCount, counterOffer?, approvedAmount?, deductions?, netAmount? }` — `eventCount` starts at 0 on draft creation and increments by exactly 1 on every status transition
  - `invoices/{invoiceId}/events/{eventId}`: `{ from, to, actorUid, at, note?, requestedAmount?, kidId }` — doc IDs are deterministic: event N is `e{N}` (`e1`, `e2`, …). Every transition batch must create `e{newEventCount}` or the invoice update is rejected (`existsAfter` check), and events validate `from` against the pre-batch invoice status — fabricated standalone events and event-less transitions are both structurally impossible.

- [ ] **Step 1: Write the failing tests**

`packages/rules-tests/src/invoices.test.ts`:
```ts
import { describe, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, query, where, serverTimestamp,
} from 'firebase/firestore';
import { setupTestEnv, parentCtx, kidCtx, seed } from './helpers.js';
import type { RulesTestEnvironment, RulesTestContext } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.cleanup(); });

const draft = {
  kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
  status: 'draft', requestedAmount: 5000, eventCount: 0,
};

beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'families/fam1'), { name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
    await setDoc(doc(db, 'families/fam1/members/p1'), { role: 'parent', displayName: 'Leo' });
    await setDoc(doc(db, 'families/fam1/kids/k1'), { name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
    await setDoc(doc(db, 'families/fam1/kids/k2'), { name: 'Sib', birthYear: 2014, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
    await setDoc(doc(db, 'families/fam1/activities/act1'), {
      titleEs: 'Lee un libro', titleEn: 'Read a book', descriptionEs: '', descriptionEn: '',
      suggestedPrice: 5000, category: 'learn', repeatable: true, active: true,
    });
  });
});

// eventCount = the invoice's NEW event count after this transition (previous + 1)
function sendBatch(db: ReturnType<RulesTestContext['firestore']>, invoiceId: string, from: string, amount: number, eventCount: number) {
  const batch = writeBatch(db);
  batch.update(doc(db, `families/fam1/invoices/${invoiceId}`), { status: 'sent', requestedAmount: amount, eventCount });
  batch.set(doc(db, `families/fam1/invoices/${invoiceId}/events/e${eventCount}`), {
    from, to: 'sent', actorUid: 'kid_fam1_k1', at: serverTimestamp(), requestedAmount: amount, kidId: 'k1',
  });
  return batch.commit();
}

describe('activities', () => {
  it('parent writes activities; kid reads but cannot write', async () => {
    const pdb = parentCtx(env, 'p1').firestore();
    await assertSucceeds(setDoc(doc(pdb, 'families/fam1/activities/act2'), {
      titleEs: 'Valentía', titleEn: 'Courage', descriptionEs: '', descriptionEn: '',
      suggestedPrice: 3000, category: 'courage', repeatable: false, active: true,
    }));
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertSucceeds(getDoc(doc(kdb, 'families/fam1/activities/act1')));
    await assertFails(updateDoc(doc(kdb, 'families/fam1/activities/act1'), { suggestedPrice: 999999 }));
  });
});

describe('invoice lifecycle', () => {
  it('kid creates own draft; cannot create for a sibling; parent cannot create', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertSucceeds(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft));
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv2'), { ...draft, kidId: 'k2' }));
    await assertFails(setDoc(doc(parentCtx(env, 'p1').firestore(), 'families/fam1/invoices/inv3'), draft));
  });

  it('create is field-whitelisted: no money fields, no nonzero eventCount', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, netAmount: 5000 }));
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, approvedAmount: 5000 }));
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, deductions: [] }));
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, eventCount: 3 }));
  });

  it('caps photos per invoice at 8 on create and on edit', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    const paths = (n: number) => Array.from({ length: n }, (_, i) => `families/fam1/kids/k1/invoices/inv1/p${i}.png`);
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, photoPaths: paths(9) }));
    await assertSucceeds(setDoc(doc(kdb, 'families/fam1/invoices/inv1'), { ...draft, photoPaths: paths(8) }));
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { photoPaths: paths(9) }));
  });

  it('kid sends draft with a matching event; send without an event fails', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { status: 'sent', eventCount: 1 }));
    await assertSucceeds(sendBatch(kdb, 'inv1', 'draft', 5000, 1));
  });

  it('fabricated standalone events are rejected', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);
    // event alone, no invoice transition in the batch: from == to, wrong id → denied
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1/events/e2'), {
      from: 'sent', to: 'approved', actorUid: 'kid_fam1_k1', at: serverTimestamp(), kidId: 'k1',
    }));
  });

  it('standalone e0 on a fresh draft is denied (from != to is load-bearing)', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    // eventCount is still 0, so 'e0' satisfies the deterministic-ID check. With no
    // invoice write in the batch the only thing left to stop it is from != to.
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1/events/e0'), {
      from: 'draft', to: 'draft', actorUid: 'kid_fam1_k1', at: serverTimestamp(), kidId: 'k1',
    }));
    // claiming a transition that did not happen fails the to == invAfter().status check
    await assertFails(setDoc(doc(kdb, 'families/fam1/invoices/inv1/events/e0'), {
      from: 'draft', to: 'sent', actorUid: 'kid_fam1_k1', at: serverTimestamp(), requestedAmount: 5000, kidId: 'k1',
    }));
  });

  it('events are key-whitelisted: no extra keys, no requestedAmount on non-sent events', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);

    // otherwise-valid send batch, but the event smuggles a money field into the
    // permanently immutable audit log
    const smuggle = writeBatch(kdb);
    smuggle.update(doc(kdb, 'families/fam1/invoices/inv1'), { status: 'sent', requestedAmount: 5000, eventCount: 1 });
    smuggle.set(doc(kdb, 'families/fam1/invoices/inv1/events/e1'), {
      from: 'draft', to: 'sent', actorUid: 'kid_fam1_k1', at: serverTimestamp(),
      requestedAmount: 5000, kidId: 'k1', netAmount: 999999,
    });
    await assertFails(smuggle.commit());

    // a legitimate send, then a return whose event carries requestedAmount it has no business holding
    await assertSucceeds(sendBatch(kdb, 'inv1', 'draft', 5000, 1));
    const pdb = parentCtx(env, 'p1').firestore();
    const ret = writeBatch(pdb);
    ret.update(doc(pdb, 'families/fam1/invoices/inv1'), { status: 'returned', eventCount: 2 });
    ret.set(doc(pdb, 'families/fam1/invoices/inv1/events/e2'), {
      from: 'sent', to: 'returned', actorUid: 'p1', at: serverTimestamp(), requestedAmount: 999999, kidId: 'k1',
    });
    await assertFails(ret.commit());
  });

  it('a sibling kid cannot read another kid\'s invoice or its events', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);

    const sib = kidCtx(env, 'fam1', 'k2').firestore();
    await assertFails(getDoc(doc(sib, 'families/fam1/invoices/inv1')));
    await assertFails(getDoc(doc(sib, 'families/fam1/invoices/inv1/events/e1')));
    await assertFails(getDocs(query(collection(sib, 'families/fam1/invoices/inv1/events'), where('kidId', '==', 'k1'))));
    await assertFails(getDocs(collection(sib, 'families/fam1/invoices/inv1/events')));
  });

  it('kid cannot edit a sent invoice; parent returns it; kid edits and resends', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { description: 'edited' }));

    const pdb = parentCtx(env, 'p1').firestore();
    const ret = writeBatch(pdb);
    ret.update(doc(pdb, 'families/fam1/invoices/inv1'), { status: 'returned', eventCount: 2 });
    ret.set(doc(pdb, 'families/fam1/invoices/inv1/events/e2'), {
      from: 'sent', to: 'returned', actorUid: 'p1', at: serverTimestamp(), note: 'Cuéntame más', kidId: 'k1',
    });
    await assertSucceeds(ret.commit());

    await assertSucceeds(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { description: 'Aprendí sobre dinosaurios' }));
    // matrix: activityId is only editable in draft
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { activityId: 'act1' }));
    await assertSucceeds(sendBatch(kdb, 'inv1', 'returned', 6000, 3));
  });

  it('parent counters with server timestamp and own uid', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);

    const pdb = parentCtx(env, 'p1').firestore();
    const counter = writeBatch(pdb);
    counter.update(doc(pdb, 'families/fam1/invoices/inv1'), {
      status: 'countered', eventCount: 2,
      counterOffer: { amount: 3000, note: 'Un poco menos', parentId: 'p1', at: serverTimestamp() },
    });
    counter.set(doc(pdb, 'families/fam1/invoices/inv1/events/e2'), {
      from: 'sent', to: 'countered', actorUid: 'p1', at: serverTimestamp(), kidId: 'k1',
    });
    await assertSucceeds(counter.commit());
  });

  it('no client can set status approved or write money fields', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);
    const pdb = parentCtx(env, 'p1').firestore();
    await assertFails(updateDoc(doc(pdb, 'families/fam1/invoices/inv1'), { status: 'approved', eventCount: 2 }));
    await assertFails(updateDoc(doc(pdb, 'families/fam1/invoices/inv1'), { netAmount: 5000 }));
    await assertFails(updateDoc(doc(kdb, 'families/fam1/invoices/inv1'), { status: 'approved', eventCount: 2 }));
  });

  it('only drafts are deletable, only by the owning kid', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await assertSucceeds(deleteDoc(doc(kdb, 'families/fam1/invoices/inv1')));
    await setDoc(doc(kdb, 'families/fam1/invoices/inv2'), draft);
    await sendBatch(kdb, 'inv2', 'draft', 5000, 1);
    await assertFails(deleteDoc(doc(kdb, 'families/fam1/invoices/inv2')));
    await assertFails(deleteDoc(doc(parentCtx(env, 'p1').firestore(), 'families/fam1/invoices/inv2')));
  });

  it('events are immutable once created', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await setDoc(doc(kdb, 'families/fam1/invoices/inv1'), draft);
    await sendBatch(kdb, 'inv1', 'draft', 5000, 1);
    const events = await getDocs(query(collection(kdb, 'families/fam1/invoices/inv1/events'), where('kidId', '==', 'k1')));
    const evRef = events.docs[0]!.ref;
    await assertFails(updateDoc(evRef, { requestedAmount: 999999 }));
    await assertFails(deleteDoc(evRef));
  });

  it('kid must query invoices constrained to own kidId; broad query fails', async () => {
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertSucceeds(getDocs(query(collection(kdb, 'families/fam1/invoices'), where('kidId', '==', 'k1'))));
    await assertFails(getDocs(collection(kdb, 'families/fam1/invoices')));
    await assertFails(getDocs(query(collection(kdb, 'families/fam1/invoices'), where('kidId', '==', 'k2'))));
    await assertSucceeds(getDocs(collection(parentCtx(env, 'p1').firestore(), 'families/fam1/invoices')));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — invoices/activities paths hit the implicit deny.

- [ ] **Step 3: Implement the rules**

Add inside `match /families/{familyId} { ... }` (after the `kids` block):
```
      match /activities/{activityId} {
        allow read: if isFamilyParent() || isFamilyKid();
        allow create, update: if isFamilyParent()
          && request.resource.data.suggestedPrice is int
          && request.resource.data.suggestedPrice >= 0;
        allow delete: if isFamilyParent();
      }

      match /invoices/{invoiceId} {
        function inv() { return resource.data; }
        function newInv() { return request.resource.data; }
        function isOwnerKid() { return isFamilyKid() && inv().kidId == authKidId(); }
        // photo count is capped here, not in storage.rules: the array lives in
        // Firestore and Storage rules cannot count objects under a prefix
        function photosWithinCap() {
          return newInv().photoPaths is list && newInv().photoPaths.size() <= 8;
        }
        function transitionHasEvent() {
          // every transition increments eventCount and the same batch must
          // create the deterministic event doc e{newEventCount}
          return newInv().eventCount == inv().eventCount + 1
            && existsAfter(/databases/$(database)/documents/families/$(familyId)/invoices/$(invoiceId)/events/$('e' + string(newInv().eventCount)));
        }

        allow get: if isFamilyParent() || (isFamilyKid() && inv().kidId == authKidId());
        allow list: if isFamilyParent() || (isFamilyKid() && resource.data.kidId == authKidId());

        allow create: if isFamilyKid()
          && newInv().keys().hasOnly(['kidId', 'activityId', 'description', 'photoPaths', 'status', 'requestedAmount', 'eventCount'])
          && newInv().kidId == authKidId()
          && newInv().status == 'draft'
          && newInv().eventCount == 0
          && newInv().requestedAmount is int && newInv().requestedAmount > 0
          && photosWithinCap();

        // kid edits in place (no transition); activityId editable only in draft
        allow update: if isOwnerKid()
          && inv().status in ['draft', 'returned', 'countered']
          && newInv().status == inv().status
          && newInv().diff(inv()).affectedKeys().hasOnly(
               inv().status == 'draft'
                 ? ['description', 'photoPaths', 'requestedAmount', 'activityId']
                 : ['description', 'photoPaths', 'requestedAmount'])
          && newInv().requestedAmount is int && newInv().requestedAmount > 0
          && photosWithinCap();

        // kid transition to sent (event required)
        allow update: if isOwnerKid()
          && inv().status in ['draft', 'returned', 'countered']
          && newInv().status == 'sent'
          && newInv().diff(inv()).affectedKeys().hasOnly(
               inv().status == 'draft'
                 ? ['status', 'eventCount', 'description', 'photoPaths', 'requestedAmount', 'activityId']
                 : ['status', 'eventCount', 'description', 'photoPaths', 'requestedAmount'])
          && newInv().requestedAmount is int && newInv().requestedAmount > 0
          && photosWithinCap()
          && transitionHasEvent();

        // parent returns (event required)
        allow update: if isFamilyParent()
          && inv().status == 'sent'
          && newInv().status == 'returned'
          && newInv().diff(inv()).affectedKeys().hasOnly(['status', 'eventCount'])
          && transitionHasEvent();

        // parent counters (event required)
        allow update: if isFamilyParent()
          && inv().status == 'sent'
          && newInv().status == 'countered'
          && newInv().diff(inv()).affectedKeys().hasOnly(['status', 'eventCount', 'counterOffer'])
          && newInv().counterOffer.amount is int && newInv().counterOffer.amount > 0
          && newInv().counterOffer.parentId == request.auth.uid
          && newInv().counterOffer.at == request.time
          && transitionHasEvent();

        allow delete: if isOwnerKid() && inv().status == 'draft';

        match /events/{eventId} {
          function invBefore() {
            return get(/databases/$(database)/documents/families/$(familyId)/invoices/$(invoiceId)).data;
          }
          function invAfter() {
            return getAfter(/databases/$(database)/documents/families/$(familyId)/invoices/$(invoiceId)).data;
          }
          allow read: if isFamilyParent()
            || (isFamilyKid() && resource.data.kidId == authKidId());
          allow create: if (isFamilyParent() || isFamilyKid())
            // events are permanently immutable, so the key set is whitelisted:
            // anything that lands here can never be corrected
            && request.resource.data.keys().hasOnly(
                 ['from', 'to', 'actorUid', 'at', 'note', 'requestedAmount', 'kidId'])
            && eventId == 'e' + string(invAfter().eventCount)
            && request.resource.data.actorUid == request.auth.uid
            && request.resource.data.at == request.time
            && request.resource.data.kidId == invAfter().kidId
            && request.resource.data.from == invBefore().status
            && request.resource.data.to == invAfter().status
            // LOAD-BEARING: do not remove. This is the only thing that stops a
            // standalone event create when the same batch does not transition the
            // invoice — including 'e0' on a fresh draft, where the deterministic-ID
            // check below passes because eventCount is still 0. With no invoice
            // write in the batch, invBefore().status == invAfter().status, so
            // requiring from != to is what makes fabricated events impossible.
            && request.resource.data.from != request.resource.data.to
            // requestedAmount belongs to 'sent' events only, and must match the invoice
            && (request.resource.data.to == 'sent'
                  ? request.resource.data.requestedAmount == invAfter().requestedAmount
                  : !request.resource.data.keys().hasAny(['requestedAmount']));
          allow update, delete: if false;
        }
      }
```

**Implementation note:** the deterministic event ID (`e{eventCount}`) is what lets the invoice rule reference the event doc via `existsAfter` — this closes both gaps: an event-less transition fails (`existsAfter` misses) and a fabricated standalone event fails (`from == invBefore().status` equals `to == invAfter().status` when the invoice didn't change, and `from != to` is required; the deterministic ID also collides with the already-existing previous event).

**This design is emulator-verified — see Task 5.5, which must pass before this task starts.** Two findings from that spike govern the implementation:

1. **Computed path segments are valid rules interpolation.** `existsAfter(.../events/$('e' + string(newInv().eventCount)))` compiles and resolves correctly (it returned `true` for an existing target). There is no `lastEventId` fallback and no reason to weaken event enforcement; if a future toolchain change breaks this, Task 5.5 fails first and loudly.
2. **`existsAfter` on a *missing* document raises a rules evaluation error rather than returning a clean `false`.** This is not specific to computed paths — a hardcoded literal path to a missing doc behaves identically. The write is still denied (rules fail closed), so the invariant holds, but it means **a denial alone does not prove the rule works**: an unrelated typo in the same `allow` expression produces the same `PERMISSION_DENIED`. Every negative test in this task is therefore paired with the corresponding positive case (`sendBatch` succeeding), which is the only assertion that proves `existsAfter` actually resolved `true` rather than the whole rule being broken. Do not "simplify" the positive assertions away.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:rules`
Expected: all tests PASS (or the documented single-assertion adjustment above, reported).

- [ ] **Step 5: Commit**

```bash
git add firestore.rules packages/rules-tests
git commit -m "feat(rules): invoice transition matrix, immutable events, kid query constraints"
```

---

### Task 7: Firestore rules — ledger + joinCodes

**Files:**
- Modify: `firestore.rules` (add `ledger` block inside family; add top-level `joinCodes` deny block before the catch-all)
- Test: `packages/rules-tests/src/ledger.test.ts`

**Interfaces:**
- Consumes: rule helpers from Task 5.
- Produces: `ledger/{entryId}`: `{ kidId, type, balance, amount, invoiceId?, note?, createdBy, at }` — client-read-only. `joinCodes/{code}` (top-level): fully client-inaccessible.

- [ ] **Step 1: Write the failing tests**

`packages/rules-tests/src/ledger.test.ts`:
```ts
import { describe, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { setupTestEnv, parentCtx, kidCtx, seed } from './helpers.js';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'families/fam1'), { name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
    await setDoc(doc(db, 'families/fam1/members/p1'), { role: 'parent', displayName: 'Leo' });
    await setDoc(doc(db, 'families/fam1/ledger/credit_inv1'), {
      kidId: 'k1', type: 'credit', balance: 'spendable', amount: 5000, invoiceId: 'inv1', createdBy: 'p1', at: new Date(),
    });
    await setDoc(doc(db, 'families/fam1/ledger/credit_inv2'), {
      kidId: 'k2', type: 'credit', balance: 'spendable', amount: 900, invoiceId: 'inv2', createdBy: 'p1', at: new Date(),
    });
    await setDoc(doc(db, 'joinCodes/ABC123'), { familyId: 'fam1', kidId: 'k1', revoked: false, expiresAt: new Date() });
  });
});

describe('ledger', () => {
  it('parent reads all; kid reads only own entries via constrained query', async () => {
    await assertSucceeds(getDocs(collection(parentCtx(env, 'p1').firestore(), 'families/fam1/ledger')));
    const kdb = kidCtx(env, 'fam1', 'k1').firestore();
    await assertSucceeds(getDocs(query(collection(kdb, 'families/fam1/ledger'), where('kidId', '==', 'k1'))));
    await assertFails(getDocs(collection(kdb, 'families/fam1/ledger')));
    await assertFails(getDoc(doc(kdb, 'families/fam1/ledger/credit_inv2')));
  });
  it('no client can write the ledger', async () => {
    const pdb = parentCtx(env, 'p1').firestore();
    await assertFails(setDoc(doc(pdb, 'families/fam1/ledger/payout_x'), {
      kidId: 'k1', type: 'payout', balance: 'spendable', amount: 100, createdBy: 'p1', at: new Date(),
    }));
    await assertFails(updateDoc(doc(pdb, 'families/fam1/ledger/credit_inv1'), { amount: 999999 }));
  });
});

describe('joinCodes', () => {
  it('is client-inaccessible to everyone', async () => {
    await assertFails(getDoc(doc(parentCtx(env, 'p1').firestore(), 'joinCodes/ABC123')));
    await assertFails(getDoc(doc(kidCtx(env, 'fam1', 'k1').firestore(), 'joinCodes/ABC123')));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — parent/kid ledger reads denied (no ledger rules yet).

- [ ] **Step 3: Implement the rules**

Add inside `match /families/{familyId}`:
```
      match /ledger/{entryId} {
        allow get, list: if isFamilyParent()
          || (isFamilyKid() && resource.data.kidId == authKidId());
        allow write: if false;
      }
```

`joinCodes` needs no explicit block — the existing implicit deny covers it — but the test documents the invariant. Keep the file's final state without any `match /joinCodes` allow.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:rules`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules packages/rules-tests
git commit -m "feat(rules): read-only ledger with kid query constraint; joinCodes stay server-only"
```

---

### Task 8: Storage rules — photo isolation

**Files:**
- Modify: `storage.rules`
- Test: `packages/rules-tests/src/storage.test.ts`

**Interfaces:**
- Consumes: kid/parent contexts from Task 4 helpers; invoice docs seeded like Task 6.
- Produces: Storage path contract `families/{familyId}/kids/{kidId}/invoices/{invoiceId}/{fileName}` for the app (Plan 3).

- [ ] **Step 1: Write the failing tests**

`packages/rules-tests/src/storage.test.ts`:
```ts
import { describe, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { setupTestEnv, parentCtx, kidCtx, seed } from './helpers.js';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.cleanup(); });

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const path = (kid: string, inv: string) => `families/fam1/kids/${kid}/invoices/${inv}/photo1.png`;

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await seed(env, async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'families/fam1'), { name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
    await setDoc(doc(db, 'families/fam1/members/p1'), { role: 'parent', displayName: 'Leo' });
    await setDoc(doc(db, 'families/fam1/invoices/inv1'), { kidId: 'k1', status: 'draft', requestedAmount: 100, description: '', photoPaths: [] });
    await setDoc(doc(db, 'families/fam1/invoices/inv2'), { kidId: 'k1', status: 'approved', requestedAmount: 100, description: '', photoPaths: [] });
    // sibling k2's editable invoice — used to prove path/owner binding
    await setDoc(doc(db, 'families/fam1/invoices/inv3'), { kidId: 'k2', status: 'draft', requestedAmount: 100, description: '', photoPaths: [] });
  });
});

describe('photo storage', () => {
  it('owning kid uploads to own editable invoice', async () => {
    const storage = kidCtx(env, 'fam1', 'k1').storage();
    await assertSucceeds(uploadBytes(ref(storage, path('k1', 'inv1')), png, { contentType: 'image/png' }));
  });
  it('sibling kid can neither upload nor read', async () => {
    const owner = kidCtx(env, 'fam1', 'k1').storage();
    await assertSucceeds(uploadBytes(ref(owner, path('k1', 'inv1')), png, { contentType: 'image/png' }));
    const sibling = kidCtx(env, 'fam1', 'k2').storage();
    await assertFails(uploadBytes(ref(sibling, path('k1', 'inv1')), png, { contentType: 'image/png' }));
    await assertFails(getBytes(ref(sibling, path('k1', 'inv1'))));
  });
  it('parent reads any family photo', async () => {
    const owner = kidCtx(env, 'fam1', 'k1').storage();
    await assertSucceeds(uploadBytes(ref(owner, path('k1', 'inv1')), png, { contentType: 'image/png' }));
    await assertSucceeds(getBytes(ref(parentCtx(env, 'p1').storage(), path('k1', 'inv1'))));
  });
  it('rejects a kid attaching a SIBLING\'s invoice under their own prefix', async () => {
    // inv3 belongs to k2 and is editable; k1 writes it under k1's own path,
    // so every owner check on the path segment passes — only the invoice's
    // own kidId stops this. Regression guard for the storage ownership bug.
    const storage = kidCtx(env, 'fam1', 'k1').storage();
    await assertFails(uploadBytes(ref(storage, path('k1', 'inv3')), png, { contentType: 'image/png' }));
  });
  it('rejects uploads to approved invoices and non-image content', async () => {
    const storage = kidCtx(env, 'fam1', 'k1').storage();
    await assertFails(uploadBytes(ref(storage, path('k1', 'inv2')), png, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(storage, path('k1', 'inv1')), png, { contentType: 'application/pdf' }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — deny-all storage rules block the success cases.

- [ ] **Step 3: Implement the rules**

Replace `storage.rules` with:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /families/{familyId}/kids/{kidId}/invoices/{invoiceId}/{fileName} {
      function isKidToken() {
        return request.auth != null && request.auth.token.get('role', '') == 'kid';
      }
      function isFamilyParent() {
        return request.auth != null && !isKidToken()
          && firestore.exists(/databases/(default)/documents/families/$(familyId)/members/$(request.auth.uid));
      }
      function isOwnerKid() {
        return isKidToken()
          && request.auth.token.familyId == familyId
          && request.auth.token.kidId == kidId;
      }
      // status alone is not enough: without the kidId check a kid could write
      // under their OWN prefix using a SIBLING's editable invoiceId, since the
      // {kidId} path segment is attacker-chosen. Both facts come from one get().
      function invoiceWritable() {
        let inv = firestore.get(/databases/(default)/documents/families/$(familyId)/invoices/$(invoiceId)).data;
        return inv.status in ['draft', 'returned', 'countered'] && inv.kidId == kidId;
      }

      allow read: if isFamilyParent() || isOwnerKid();
      allow write: if (isFamilyParent() || isOwnerKid())
        && invoiceWritable()
        && (request.resource == null
            || (request.resource.size <= 5 * 1024 * 1024
                && request.resource.contentType.matches('image/.*')));
    }
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

(`request.resource == null` permits deletes while an invoice is editable.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:rules`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add storage.rules packages/rules-tests
git commit -m "feat(rules): storage photo isolation with sibling privacy and image limits"
```

---

### Task 9: Functions scaffold + join codes + revocation

**Files:**
- Create: `functions/package.json`, `functions/tsconfig.json`, `functions/vitest.config.ts`, `functions/src/index.ts`, `functions/src/auth.ts`, `functions/src/joinCodes.ts`
- Test: `functions/src/joinCodes.test.ts`
- Modify: root `package.json` (add `test:functions` script), `firebase.json` (point functions source)

**Interfaces:**
- Consumes: `@money-kids/shared`.
- Produces:
  - `assertParentCaller(db, familyId, auth): Promise<void>` in `auth.ts` — throws `HttpsError('permission-denied')` unless caller is a non-kid member of the family (used by Tasks 10–12)
  - Core functions (unit-tested directly against emulator; thin `onCall` wrappers in `index.ts`):
    - `createJoinCodeCore(db, auth, { familyId, kidId }): Promise<{ code: string }>` — parent-only; writes `joinCodes/{code}` = `{ familyId, kidId, revoked: false, expiresAt: <now + 48h>, createdBy }`
    - `mintKidTokenCore(db, adminAuth, { code }): Promise<{ token: string }>` — public; validates code not revoked/expired; returns custom token for uid `kid_{familyId}_{kidId}` with claims `{ familyId, kidId, role: 'kid' }`
    - `revokeKidAccessCore(db, adminAuth, auth, { familyId, kidId }): Promise<void>` — parent-only; verifies the kid exists in the caller's family, marks all of the kid's codes revoked, and calls `adminAuth.revokeRefreshTokens('kid_' + familyId + '_' + kidId)`
  - Exported callables: `createJoinCode`, `mintKidToken`, `revokeKidAccess`

- [ ] **Step 1: Scaffold the functions workspace**

`functions/package.json`:
```json
{
  "name": "@money-kids/functions",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "engines": { "node": "20" },
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/index.js --external:firebase-admin --external:firebase-functions --banner:js=\"import { createRequire } from 'module'; const require = createRequire(import.meta.url);\"",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@money-kids/shared": "*",
    "firebase-admin": "^12.1.0",
    "firebase-functions": "^5.0.0"
  },
  "devDependencies": { "esbuild": "^0.21.0", "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

`functions/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "include": ["src"] }
```

`functions/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], fileParallelism: false, testTimeout: 20000 },
});
```

Add to `firebase.json` top level:
```json
"functions": { "source": "functions", "predeploy": ["npm run build -w @money-kids/functions"] }
```

Add root script:
```json
"test:functions": "firebase emulators:exec --only firestore,auth --project money-kids-test \"npm test -w @money-kids/functions\""
```

- [ ] **Step 2: Write the failing tests**

`functions/src/joinCodes.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { createJoinCodeCore, mintKidTokenCore, revokeKidAccessCore } from './joinCodes.js';

// Requires FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST (set by emulators:exec)
let db: Firestore;
let adminAuth: Auth;
const parentAuth = { uid: 'p1', token: {} } as never;
const kidAuth = { uid: 'kid_fam1_k1', token: { role: 'kid', familyId: 'fam1', kidId: 'k1' } } as never;

beforeAll(() => {
  process.env.GCLOUD_PROJECT = 'money-kids-test';
  initializeApp({ projectId: 'money-kids-test' });
  db = getFirestore();
  adminAuth = getAuth();
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  const codes = await db.collection('joinCodes').get();
  await Promise.all(codes.docs.map((d) => d.ref.delete()));
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/fam1/kids/k1').set({ name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
  // a SECOND, real family — 'stranger' proves only the membership check;
  // family scoping needs an actual member of another family
  await db.recursiveDelete(db.collection('families').doc('fam2'));
  await db.doc('families/fam2').set({ name: 'Other', language: 'en', currency: 'USD', createdBy: 'p2', deductionRules: [] });
  await db.doc('families/fam2/members/p2').set({ role: 'parent', displayName: 'Ana' });
  await db.doc('families/fam2/kids/k9').set({ name: 'Otro', birthYear: 2015, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
});

const foreignParentAuth = { uid: 'p2', token: {} } as never; // real parent of fam2

describe('createJoinCodeCore', () => {
  it('parent gets a code stored with the right target', async () => {
    const { code } = await createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    const snap = await db.doc(`joinCodes/${code}`).get();
    expect(snap.get('familyId')).toBe('fam1');
    expect(snap.get('kidId')).toBe('k1');
    expect(snap.get('revoked')).toBe(false);
  });
  it('rejects non-members, kid tokens, and cross-family kid targets', async () => {
    await expect(createJoinCodeCore(db, { uid: 'stranger', token: {} } as never, { familyId: 'fam1', kidId: 'k1' })).rejects.toThrow(/permission-denied|not a member/i);
    await expect(createJoinCodeCore(db, kidAuth, { familyId: 'fam1', kidId: 'k1' })).rejects.toThrow();
    await expect(createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'ghost' })).rejects.toThrow(/not found/i);
  });
  it('rejects members whose role is not parent', async () => {
    await db.doc('families/fam1/members/aunt').set({ role: 'viewer', displayName: 'Tía' });
    await expect(createJoinCodeCore(db, { uid: 'aunt', token: {} } as never, { familyId: 'fam1', kidId: 'k1' })).rejects.toThrow(/parent role/i);
  });
  it('rejects a real parent of another family targeting this family', async () => {
    await expect(createJoinCodeCore(db, foreignParentAuth, { familyId: 'fam1', kidId: 'k1' }))
      .rejects.toThrow(/not a member/i);
    // ...and cannot reach across to a kid of their own family from fam1's scope
    await expect(createJoinCodeCore(db, foreignParentAuth, { familyId: 'fam1', kidId: 'k9' }))
      .rejects.toThrow(/not a member/i);
    // the mirror direction: fam1's parent cannot target fam2
    await expect(createJoinCodeCore(db, parentAuth, { familyId: 'fam2', kidId: 'k9' }))
      .rejects.toThrow(/not a member/i);
  });
  it('rejects malformed ids before they reach a document path', async () => {
    await expect(createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1/../k9' }))
      .rejects.toThrow(/kidId/);
    await expect(createJoinCodeCore(db, parentAuth, { familyId: 'fam1/members/p1', kidId: 'k1' }))
      .rejects.toThrow(/familyId/);
    await expect(createJoinCodeCore(db, parentAuth, { familyId: '', kidId: 'k1' }))
      .rejects.toThrow(/familyId/);
  });
});

describe('mintKidTokenCore', () => {
  it('mints a custom token for a valid code', async () => {
    const { code } = await createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    const { token } = await mintKidTokenCore(db, adminAuth, { code });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });
  it('rejects unknown, revoked, and expired codes', async () => {
    await expect(mintKidTokenCore(db, adminAuth, { code: 'NOPE9999' })).rejects.toThrow(/invalid/i);
    const { code } = await createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    await db.doc(`joinCodes/${code}`).update({ revoked: true });
    await expect(mintKidTokenCore(db, adminAuth, { code })).rejects.toThrow(/invalid/i);
    const { code: code2 } = await createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    await db.doc(`joinCodes/${code2}`).update({ expiresAt: new Date(Date.now() - 1000) });
    await expect(mintKidTokenCore(db, adminAuth, { code: code2 })).rejects.toThrow(/invalid/i);
  });
  it('rejects malformed codes as plain invalid, leaking nothing', async () => {
    // public callable: a malformed code must be indistinguishable from a wrong one
    for (const bad of ['', 'abc', 'abcd2345', 'ABCD/../X', 'ABCD23450', 'ABCD2340']) {
      await expect(mintKidTokenCore(db, adminAuth, { code: bad })).rejects.toThrow(/invalid/i);
    }
  });
});

describe('revokeKidAccessCore', () => {
  it('revokes all codes for the kid and their refresh tokens', async () => {
    const { code } = await createJoinCodeCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    await revokeKidAccessCore(db, adminAuth, parentAuth, { familyId: 'fam1', kidId: 'k1' });
    const snap = await db.doc(`joinCodes/${code}`).get();
    expect(snap.get('revoked')).toBe(true);
    await expect(mintKidTokenCore(db, adminAuth, { code })).rejects.toThrow(/invalid/i);
  });
  it('rejects non-parent callers', async () => {
    await expect(revokeKidAccessCore(db, adminAuth, kidAuth, { familyId: 'fam1', kidId: 'k1' })).rejects.toThrow();
  });
  it('rejects a real parent of another family, and malformed ids', async () => {
    await expect(revokeKidAccessCore(db, adminAuth, foreignParentAuth, { familyId: 'fam1', kidId: 'k1' }))
      .rejects.toThrow(/not a member/i);
    await expect(revokeKidAccessCore(db, adminAuth, parentAuth, { familyId: 'fam1', kidId: '../k9' }))
      .rejects.toThrow(/kidId/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm install && npm run test:functions`
Expected: FAIL — `joinCodes.js` not found.

- [ ] **Step 4: Implement**

`functions/src/auth.ts`:
```ts
import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';

export interface CallerAuth {
  uid: string;
  token: { role?: string; familyId?: string; kidId?: string };
}

/**
 * Runs shared validators (which throw plain Errors) and rethrows as a callable
 * `invalid-argument`. Every callable validates its payload BEFORE using any
 * field in a document path — authorization is not validation.
 */
export function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new HttpsError('invalid-argument', (e as Error).message);
  }
}

export async function assertParentCaller(
  db: Firestore,
  familyId: string,
  auth: CallerAuth | undefined,
): Promise<void> {
  if (!auth) throw new HttpsError('unauthenticated', 'sign in required');
  if (auth.token.role === 'kid') throw new HttpsError('permission-denied', 'parent role required');
  const member = await db.doc(`families/${familyId}/members/${auth.uid}`).get();
  if (!member.exists) throw new HttpsError('permission-denied', 'not a member of this family');
  // callable functions bypass Firestore rules — role must be checked here too
  if (member.get('role') !== 'parent') throw new HttpsError('permission-denied', 'parent role required');
}

export function assertKidCaller(familyId: string, auth: CallerAuth | undefined): string {
  if (!auth || auth.token.role !== 'kid' || auth.token.familyId !== familyId || !auth.token.kidId) {
    throw new HttpsError('permission-denied', 'kid session for this family required');
  }
  return auth.token.kidId;
}
```

`functions/src/joinCodes.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { validateId, validateJoinCode } from '@money-kids/shared';
import { checked, assertParentCaller, type CallerAuth } from './auth.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_TTL_MS = 48 * 60 * 60 * 1000;

function randomCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export async function createJoinCodeCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { familyId: string; kidId: string },
): Promise<{ code: string }> {
  checked(() => {
    validateId(data.familyId, 'familyId');
    validateId(data.kidId, 'kidId');
  });
  await assertParentCaller(db, data.familyId, auth);
  const kid = await db.doc(`families/${data.familyId}/kids/${data.kidId}`).get();
  if (!kid.exists) throw new HttpsError('not-found', 'kid not found in this family');
  const code = randomCode();
  await db.doc(`joinCodes/${code}`).create({
    familyId: data.familyId,
    kidId: data.kidId,
    revoked: false,
    expiresAt: Timestamp.fromMillis(Date.now() + CODE_TTL_MS),
    createdBy: auth!.uid,
  });
  return { code };
}

export async function mintKidTokenCore(
  db: Firestore,
  adminAuth: Auth,
  data: { code: string },
): Promise<{ token: string }> {
  // this callable is public/unauthenticated — the code is the only credential,
  // so its shape is validated before it reaches a document path
  const invalid = new HttpsError('permission-denied', 'invalid or expired code');
  let code: string;
  try {
    code = validateJoinCode(data.code);
  } catch {
    throw invalid; // never leak whether a malformed code could have existed
  }
  const snap = await db.doc(`joinCodes/${code}`).get();
  if (!snap.exists) throw invalid;
  const { familyId, kidId, revoked, expiresAt } = snap.data() as {
    familyId: string; kidId: string; revoked: boolean; expiresAt: Timestamp;
  };
  if (revoked || expiresAt.toMillis() < Date.now()) throw invalid;
  // UID is family-namespaced: kid doc IDs are only unique within a family
  const token = await adminAuth.createCustomToken(`kid_${familyId}_${kidId}`, { familyId, kidId, role: 'kid' });
  return { token };
}

export async function revokeKidAccessCore(
  db: Firestore,
  adminAuth: Auth,
  auth: CallerAuth | undefined,
  data: { familyId: string; kidId: string },
): Promise<void> {
  checked(() => {
    validateId(data.familyId, 'familyId');
    validateId(data.kidId, 'kidId');
  });
  await assertParentCaller(db, data.familyId, auth);
  const kid = await db.doc(`families/${data.familyId}/kids/${data.kidId}`).get();
  if (!kid.exists) throw new HttpsError('not-found', 'kid not found in this family');
  const codes = await db.collection('joinCodes')
    .where('familyId', '==', data.familyId)
    .where('kidId', '==', data.kidId)
    .get();
  const batch = db.batch();
  for (const c of codes.docs) batch.update(c.ref, { revoked: true });
  await batch.commit();
  await adminAuth.revokeRefreshTokens(`kid_${data.familyId}_${data.kidId}`).catch((e: { code?: string }) => {
    if (e.code !== 'auth/user-not-found') throw e; // kid may never have signed in
  });
}
```

`functions/src/index.ts`:
```ts
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall } from 'firebase-functions/v2/https';
import { createJoinCodeCore, mintKidTokenCore, revokeKidAccessCore } from './joinCodes.js';

initializeApp();

export const createJoinCode = onCall(async (req) =>
  createJoinCodeCore(getFirestore(), req.auth, req.data));

export const mintKidToken = onCall({ invoker: 'public' }, async (req) =>
  mintKidTokenCore(getFirestore(), getAuth(), req.data));

export const revokeKidAccess = onCall(async (req) =>
  revokeKidAccessCore(getFirestore(), getAuth(), req.auth, req.data));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:functions`
Expected: all tests PASS. Also run `npm run build -w @money-kids/functions` — bundle succeeds.

- [ ] **Step 6: Commit**

```bash
git add functions firebase.json package.json package-lock.json
git commit -m "feat(functions): join-code minting and kid access revocation"
```

---

### Task 10: `approveInvoice` callable

**Files:**
- Create: `functions/src/approval.ts`
- Test: `functions/src/approval.test.ts`
- Modify: `functions/src/index.ts` (export callable)

**Interfaces:**
- Consumes: `computeDeductions` from `@money-kids/shared`; `assertParentCaller` from Task 9; document shapes from Tasks 5–7.
- Produces:
  - `approveInTransaction(db, familyId, invoiceId, opts: { gross: number; actorUid: string; expectedStatus: 'sent' | 'countered' }): Promise<{ approvedAmount: number; netAmount: number }>` — shared by Task 11
  - `approveInvoiceCore(db, auth, { familyId, invoiceId })` — parent-only, approves from `sent` at `requestedAmount`
  - Exported callable: `approveInvoice`

- [ ] **Step 1: Write the failing tests**

`functions/src/approval.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { approveInvoiceCore } from './approval.js';

let db: Firestore;
const parentAuth = { uid: 'p1', token: {} } as never;
const kidAuth = { uid: 'kid_fam1_k1', token: { role: 'kid', familyId: 'fam1', kidId: 'k1' } } as never;

const rules = [
  { nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000, destination: 'savings' },
  { nameEs: 'Impuesto', nameEn: 'Tax', basisPoints: 1000, destination: 'withheld' },
];

beforeAll(() => {
  process.env.GCLOUD_PROJECT = 'money-kids-test';
  if (getApps().length === 0) initializeApp({ projectId: 'money-kids-test' });
  db = getFirestore();
});

async function seedInvoice(deductionsEnabled: boolean, invoice: Record<string, unknown> = {}) {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: rules });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/fam1/kids/k1').set({ name: 'Mia', birthYear: 2016, deductionsEnabled, spendableBalance: 0, savingsBalance: 0 });
  await db.doc('families/fam1/invoices/inv1').set({
    kidId: 'k1', activityId: null, description: 'Leí un libro', photoPaths: [],
    status: 'sent', requestedAmount: 10000, eventCount: 1, ...invoice,
  });
}

beforeEach(async () => { await seedInvoice(true); });

describe('approveInvoiceCore', () => {
  it('approves with deductions: freezes breakdown, writes ledger, updates balances', async () => {
    const result = await approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' });
    expect(result).toEqual({ approvedAmount: 10000, netAmount: 7000 });

    const inv = await db.doc('families/fam1/invoices/inv1').get();
    expect(inv.get('status')).toBe('approved');
    expect(inv.get('netAmount')).toBe(7000);
    expect(inv.get('deductions')).toHaveLength(2);

    const credit = await db.doc('families/fam1/ledger/credit_inv1').get();
    expect(credit.get('amount')).toBe(7000);
    expect(credit.get('balance')).toBe('spendable');
    const savings = await db.doc('families/fam1/ledger/savings_inv1').get();
    expect(savings.get('amount')).toBe(2000);
    expect(savings.get('type')).toBe('savings-credit');

    const kid = await db.doc('families/fam1/kids/k1').get();
    expect(kid.get('spendableBalance')).toBe(7000);
    expect(kid.get('savingsBalance')).toBe(2000);

    const events = await db.collection('families/fam1/invoices/inv1/events').get();
    expect(events.docs.some((e) => e.get('to') === 'approved' && e.get('actorUid') === 'p1')).toBe(true);
  });

  it('honors the per-kid deductions toggle: gross credited, no savings entry', async () => {
    await seedInvoice(false);
    const result = await approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' });
    expect(result).toEqual({ approvedAmount: 10000, netAmount: 10000 });
    const inv = await db.doc('families/fam1/invoices/inv1').get();
    expect(inv.get('deductions')).toEqual([]);
    expect((await db.doc('families/fam1/ledger/savings_inv1').get()).exists).toBe(false);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(10000);
  });

  it('double approval is impossible', async () => {
    await approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' });
    await expect(approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' }))
      .rejects.toThrow(/cannot approve/i);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(7000);
  });

  it('rejects kid callers and unaffiliated strangers', async () => {
    await expect(approveInvoiceCore(db, kidAuth, { familyId: 'fam1', invoiceId: 'inv1' })).rejects.toThrow();
    await expect(approveInvoiceCore(db, { uid: 'stranger', token: {} } as never, { familyId: 'fam1', invoiceId: 'inv1' })).rejects.toThrow();
  });

  it('rejects a real parent of ANOTHER family, in both directions, with no money moved', async () => {
    // a stranger uid only proves the membership lookup; family scoping needs a
    // caller who genuinely passes the parent-role check in their own family
    await db.doc('families/fam2').set({ name: 'Other', language: 'en', currency: 'USD', createdBy: 'p2', deductionRules: [] });
    await db.doc('families/fam2/members/p2').set({ role: 'parent', displayName: 'Ana' });
    await db.doc('families/fam2/kids/k9').set({ name: 'Otro', birthYear: 2015, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
    await db.doc('families/fam2/invoices/inv9').set({
      kidId: 'k9', activityId: null, description: 'suyo', photoPaths: [],
      status: 'sent', requestedAmount: 4000, eventCount: 1,
    });

    // fam2's parent cannot approve fam1's invoice
    await expect(approveInvoiceCore(db, { uid: 'p2', token: {} } as never, { familyId: 'fam1', invoiceId: 'inv1' }))
      .rejects.toThrow(/not a member/i);
    // fam1's parent cannot approve fam2's invoice
    await expect(approveInvoiceCore(db, parentAuth, { familyId: 'fam2', invoiceId: 'inv9' }))
      .rejects.toThrow(/not a member/i);
    // an invoice id from the OTHER family, passed under the caller's own familyId,
    // must not resolve — invoices are addressed within the family subtree
    await expect(approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv9' }))
      .rejects.toThrow(/not found/i);

    // nothing was credited anywhere
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(0);
    expect((await db.doc('families/fam2/kids/k9').get()).get('spendableBalance')).toBe(0);
    await db.recursiveDelete(db.collection('families').doc('fam2'));
  });

  it('rejects malformed ids before they reach a document path', async () => {
    await expect(approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1/../inv2' }))
      .rejects.toThrow(/invoiceId/);
    await expect(approveInvoiceCore(db, parentAuth, { familyId: '..', invoiceId: 'inv1' }))
      .rejects.toThrow(/familyId/);
  });

  it('rejects approving a one-time activity twice for the same kid', async () => {
    await db.doc('families/fam1/activities/act1').set({
      titleEs: 'Valentía', titleEn: 'Courage', descriptionEs: '', descriptionEn: '',
      suggestedPrice: 3000, category: 'courage', repeatable: false, active: true,
    });
    await db.doc('families/fam1/invoices/inv1').update({ activityId: 'act1' });
    await approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' });
    await db.doc('families/fam1/invoices/inv2').set({
      kidId: 'k1', activityId: 'act1', description: 'otra vez', photoPaths: [],
      status: 'sent', requestedAmount: 3000, eventCount: 1,
    });
    await expect(approveInvoiceCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv2' }))
      .rejects.toThrow(/one-time/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — `approval.js` not found.

- [ ] **Step 3: Implement**

`functions/src/approval.ts`:
```ts
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { computeDeductions, validateId, type DeductionRule } from '@money-kids/shared';
import { checked, assertParentCaller, type CallerAuth } from './auth.js';

export async function approveInTransaction(
  db: Firestore,
  familyId: string,
  invoiceId: string,
  opts: { gross: number; actorUid: string; expectedStatus: 'sent' | 'countered' },
): Promise<{ approvedAmount: number; netAmount: number }> {
  return db.runTransaction(async (tx) => {
    const famRef = db.doc(`families/${familyId}`);
    const invRef = famRef.collection('invoices').doc(invoiceId);
    const inv = await tx.get(invRef);
    if (!inv.exists) throw new HttpsError('not-found', 'invoice not found');
    const data = inv.data()!;
    if (data.status !== opts.expectedStatus) {
      throw new HttpsError('failed-precondition', `cannot approve from status ${data.status}`);
    }
    const kidRef = famRef.collection('kids').doc(data.kidId);
    const [kid, family] = [await tx.get(kidRef), await tx.get(famRef)];
    if (!kid.exists) throw new HttpsError('not-found', 'kid not found');

    if (data.activityId) {
      const activity = await tx.get(famRef.collection('activities').doc(data.activityId));
      if (activity.exists && activity.get('repeatable') === false) {
        const dup = await tx.get(
          famRef.collection('invoices')
            .where('kidId', '==', data.kidId)
            .where('activityId', '==', data.activityId)
            .where('status', '==', 'approved')
            .limit(1),
        );
        if (!dup.empty) {
          throw new HttpsError('failed-precondition', 'one-time activity already approved for this kid');
        }
      }
    }

    const rules: DeductionRule[] = kid.get('deductionsEnabled')
      ? (family.get('deductionRules') ?? [])
      : [];
    const breakdown = computeDeductions(opts.gross, rules);

    const nextEventCount = (data.eventCount ?? 0) + 1;
    tx.update(invRef, {
      status: 'approved',
      approvedAmount: breakdown.gross,
      deductions: breakdown.lines,
      netAmount: breakdown.netAmount,
      eventCount: nextEventCount,
    });
    tx.create(invRef.collection('events').doc(`e${nextEventCount}`), {
      from: opts.expectedStatus, to: 'approved', actorUid: opts.actorUid,
      at: FieldValue.serverTimestamp(), kidId: data.kidId,
    });
    if (breakdown.netAmount > 0) {
      tx.create(famRef.collection('ledger').doc(`credit_${invoiceId}`), {
        kidId: data.kidId, type: 'credit', balance: 'spendable', amount: breakdown.netAmount,
        invoiceId, createdBy: opts.actorUid, at: FieldValue.serverTimestamp(),
      });
    }
    if (breakdown.savingsTotal > 0) {
      tx.create(famRef.collection('ledger').doc(`savings_${invoiceId}`), {
        kidId: data.kidId, type: 'savings-credit', balance: 'savings', amount: breakdown.savingsTotal,
        invoiceId, createdBy: opts.actorUid, at: FieldValue.serverTimestamp(),
      });
    }
    tx.update(kidRef, {
      spendableBalance: FieldValue.increment(breakdown.netAmount),
      savingsBalance: FieldValue.increment(breakdown.savingsTotal),
    });
    return { approvedAmount: breakdown.gross, netAmount: breakdown.netAmount };
  });
}

export async function approveInvoiceCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { familyId: string; invoiceId: string },
): Promise<{ approvedAmount: number; netAmount: number }> {
  checked(() => {
    validateId(data.familyId, 'familyId');
    validateId(data.invoiceId, 'invoiceId');
  });
  await assertParentCaller(db, data.familyId, auth);
  const inv = await db.doc(`families/${data.familyId}/invoices/${data.invoiceId}`).get();
  if (!inv.exists) throw new HttpsError('not-found', 'invoice not found');
  return approveInTransaction(db, data.familyId, data.invoiceId, {
    gross: inv.get('requestedAmount'),
    actorUid: auth!.uid,
    expectedStatus: 'sent',
  });
}
```

Add to `functions/src/index.ts`:
```ts
import { approveInvoiceCore } from './approval.js';

export const approveInvoice = onCall(async (req) =>
  approveInvoiceCore(getFirestore(), req.auth, req.data));
```

Note: the `where('status','==','approved')` query inside the transaction needs a composite index in production (`kidId + activityId + status`); add to `firestore.indexes.json`:
```json
{
  "indexes": [
    {
      "collectionGroup": "invoices",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "kidId", "order": "ASCENDING" },
        { "fieldPath": "activityId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:functions`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions firestore.indexes.json
git commit -m "feat(functions): server-authoritative invoice approval with deductions"
```

---

### Task 11: `acceptCounterOffer` callable

**Files:**
- Create: `functions/src/counterOffer.ts`
- Test: `functions/src/counterOffer.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `approveInTransaction` (Task 10), `assertKidCaller` (Task 9).
- Produces: `acceptCounterOfferCore(db, auth, { familyId, invoiceId })` — kid-only, own invoice, status `countered`, approves at `counterOffer.amount`. Callable: `acceptCounterOffer`.

- [ ] **Step 1: Write the failing tests**

`functions/src/counterOffer.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { acceptCounterOfferCore } from './counterOffer.js';

let db: Firestore;
const kidAuth = { uid: 'kid_fam1_k1', token: { role: 'kid', familyId: 'fam1', kidId: 'k1' } } as never;
const siblingAuth = { uid: 'kid_fam1_k2', token: { role: 'kid', familyId: 'fam1', kidId: 'k2' } } as never;
const parentAuth = { uid: 'p1', token: {} } as never;

beforeAll(() => {
  process.env.GCLOUD_PROJECT = 'money-kids-test';
  if (getApps().length === 0) initializeApp({ projectId: 'money-kids-test' });
  db = getFirestore();
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/fam1/kids/k1').set({ name: 'Mia', birthYear: 2016, deductionsEnabled: false, spendableBalance: 0, savingsBalance: 0 });
  await db.doc('families/fam1/invoices/inv1').set({
    kidId: 'k1', activityId: null, description: 'idea', photoPaths: [],
    status: 'countered', requestedAmount: 8000, eventCount: 2,
    counterOffer: { amount: 5000, note: 'menos', parentId: 'p1', at: Timestamp.now() },
  });
});

describe('acceptCounterOfferCore', () => {
  it('kid accepts: approved strictly at the counter amount, not the requested one', async () => {
    const result = await acceptCounterOfferCore(db, kidAuth, { familyId: 'fam1', invoiceId: 'inv1' });
    expect(result.approvedAmount).toBe(5000);
    const inv = await db.doc('families/fam1/invoices/inv1').get();
    expect(inv.get('status')).toBe('approved');
    expect(inv.get('approvedAmount')).toBe(5000);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(5000);
  });
  it('rejects a sibling, a parent caller, and a non-countered invoice', async () => {
    await expect(acceptCounterOfferCore(db, siblingAuth, { familyId: 'fam1', invoiceId: 'inv1' })).rejects.toThrow();
    await expect(acceptCounterOfferCore(db, parentAuth, { familyId: 'fam1', invoiceId: 'inv1' })).rejects.toThrow();
    await db.doc('families/fam1/invoices/inv1').update({ status: 'sent' });
    await expect(acceptCounterOfferCore(db, kidAuth, { familyId: 'fam1', invoiceId: 'inv1' })).rejects.toThrow(/cannot approve/i);
  });
  it('rejects a kid of another family holding a valid kid token', async () => {
    // claims are well-formed and role is 'kid', but for fam2 — the familyId in
    // the claim must match the target family, not merely be present
    const foreignKidAuth = { uid: 'kid_fam2_k9', token: { role: 'kid', familyId: 'fam2', kidId: 'k9' } } as never;
    await expect(acceptCounterOfferCore(db, foreignKidAuth, { familyId: 'fam1', invoiceId: 'inv1' }))
      .rejects.toThrow(/kid session for this family/i);
    // and a fam1 kid cannot reach into fam2
    await expect(acceptCounterOfferCore(db, kidAuth, { familyId: 'fam2', invoiceId: 'inv1' }))
      .rejects.toThrow(/kid session for this family/i);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(0);
  });
  it('rejects malformed ids before they reach a document path', async () => {
    await expect(acceptCounterOfferCore(db, kidAuth, { familyId: 'fam1', invoiceId: '../../fam2/invoices/inv9' }))
      .rejects.toThrow(/invoiceId/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`functions/src/counterOffer.ts`:
```ts
import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { validateId } from '@money-kids/shared';
import { approveInTransaction } from './approval.js';
import { checked, assertKidCaller, type CallerAuth } from './auth.js';

export async function acceptCounterOfferCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { familyId: string; invoiceId: string },
): Promise<{ approvedAmount: number; netAmount: number }> {
  checked(() => {
    validateId(data.familyId, 'familyId');
    validateId(data.invoiceId, 'invoiceId');
  });
  const kidId = assertKidCaller(data.familyId, auth);
  const inv = await db.doc(`families/${data.familyId}/invoices/${data.invoiceId}`).get();
  if (!inv.exists) throw new HttpsError('not-found', 'invoice not found');
  if (inv.get('kidId') !== kidId) throw new HttpsError('permission-denied', 'not your invoice');
  const counterAmount: number | undefined = inv.get('counterOffer')?.amount;
  if (!counterAmount) throw new HttpsError('failed-precondition', 'no counter-offer to accept');
  return approveInTransaction(db, data.familyId, data.invoiceId, {
    gross: counterAmount,
    actorUid: auth!.uid,
    expectedStatus: 'countered',
  });
}
```

Add to `functions/src/index.ts`:
```ts
import { acceptCounterOfferCore } from './counterOffer.js';

export const acceptCounterOffer = onCall(async (req) =>
  acceptCounterOfferCore(getFirestore(), req.auth, req.data));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:functions`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions
git commit -m "feat(functions): kid-callable counter-offer acceptance at parent's amount"
```

---

### Task 12: `recordPayout` + `setDeductionRules` callables

**Files:**
- Create: `functions/src/payout.ts`, `functions/src/deductionRules.ts`
- Test: `functions/src/payout.test.ts`, `functions/src/deductionRules.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `assertParentCaller` (Task 9), `validateDeductionRules` (Task 2).
- Produces:
  - `recordPayoutCore(db, auth, { familyId, kidId, balance: 'spendable' | 'savings', amount, note, requestId })` — parent-only; ledger doc `payout_{requestId}`; enforces `0 < amount <= that balance`. **Truly idempotent:** retrying an already-recorded `requestId` with an identical full payload (kidId, balance, amount, note, and the same calling parent) succeeds as a no-op — a client that lost the response can safely retry; the same `requestId` with any difference in payload or caller throws `already-exists`
  - `setDeductionRulesCore(db, auth, { familyId, rules })` — parent-only; validates then writes `deductionRules` on the family (admin write bypasses the client immutability rule by design)
  - Callables: `recordPayout`, `setDeductionRules`

- [ ] **Step 1: Write the failing tests**

`functions/src/payout.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { recordPayoutCore } from './payout.js';

let db: Firestore;
const parentAuth = { uid: 'p1', token: {} } as never;
const kidAuth = { uid: 'kid_fam1_k1', token: { role: 'kid', familyId: 'fam1', kidId: 'k1' } } as never;

beforeAll(() => {
  process.env.GCLOUD_PROJECT = 'money-kids-test';
  if (getApps().length === 0) initializeApp({ projectId: 'money-kids-test' });
  db = getFirestore();
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
  await db.doc('families/fam1/kids/k1').set({ name: 'Mia', birthYear: 2016, deductionsEnabled: true, spendableBalance: 7000, savingsBalance: 2000 });
});

describe('recordPayoutCore', () => {
  it('debits the chosen balance and writes an idempotent ledger entry', async () => {
    await recordPayoutCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1', balance: 'spendable', amount: 3000, note: 'efectivo', requestId: 'req-0001' });
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(4000);
    const entry = await db.doc('families/fam1/ledger/payout_req-0001').get();
    expect(entry.get('type')).toBe('payout');
    expect(entry.get('balance')).toBe('spendable');
    expect(entry.get('amount')).toBe(3000);
    // retry with same requestId + identical payload: idempotent success, no double debit
    await recordPayoutCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1', balance: 'spendable', amount: 3000, note: 'efectivo', requestId: 'req-0001' });
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(4000);
    // same requestId with a different payload: rejected, still no double debit
    await expect(recordPayoutCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1', balance: 'spendable', amount: 100, note: 'efectivo', requestId: 'req-0001' })).rejects.toThrow(/mismatch/i);
    // same payload but a DIFFERENT parent: also rejected (not their payout)
    await db.doc('families/fam1/members/p2').set({ role: 'parent', displayName: 'Ana' });
    await expect(recordPayoutCore(db, { uid: 'p2', token: {} } as never, { familyId: 'fam1', kidId: 'k1', balance: 'spendable', amount: 3000, note: 'efectivo', requestId: 'req-0001' })).rejects.toThrow(/mismatch/i);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(4000);
  });
  it('savings payouts debit savings', async () => {
    await recordPayoutCore(db, parentAuth, { familyId: 'fam1', kidId: 'k1', balance: 'savings', amount: 2000, note: '', requestId: 'req-0002' });
    expect((await db.doc('families/fam1/kids/k1').get()).get('savingsBalance')).toBe(0);
  });
  it('rejects zero, negative, over-balance, and kid callers', async () => {
    const base = { familyId: 'fam1', kidId: 'k1', balance: 'spendable' as const, note: '', requestId: 'req-0003' };
    await expect(recordPayoutCore(db, parentAuth, { ...base, amount: 0 })).rejects.toThrow(/amount/i);
    await expect(recordPayoutCore(db, parentAuth, { ...base, amount: -5 })).rejects.toThrow(/amount/i);
    await expect(recordPayoutCore(db, parentAuth, { ...base, amount: 7001 })).rejects.toThrow(/exceeds/i);
    await expect(recordPayoutCore(db, kidAuth, { ...base, amount: 100 })).rejects.toThrow();
  });

  it('rejects a real parent of another family, with no debit', async () => {
    await db.doc('families/fam2').set({ name: 'Other', language: 'en', currency: 'USD', createdBy: 'p2', deductionRules: [] });
    await db.doc('families/fam2/members/p2').set({ role: 'parent', displayName: 'Ana' });
    const foreign = { uid: 'p2', token: {} } as never;
    await expect(recordPayoutCore(db, foreign, { familyId: 'fam1', kidId: 'k1', balance: 'spendable', amount: 1000, note: '', requestId: 'req-0004' }))
      .rejects.toThrow(/not a member/i);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(7000);
    await db.recursiveDelete(db.collection('families').doc('fam2'));
  });

  it('rejects malformed payloads before any path or ledger ID is built', async () => {
    const base = { familyId: 'fam1', kidId: 'k1', balance: 'spendable' as const, note: '', amount: 100 };
    // requestId becomes part of the ledger doc ID — must not carry separators.
    // (Note it CAN legitimately contain '_': the 'payout_' prefix keeps
    // 'payout_credit_inv1' a distinct doc from 'credit_inv1', so only path
    // separators and out-of-range lengths are rejected.)
    await expect(recordPayoutCore(db, parentAuth, { ...base, requestId: 'r1' })).rejects.toThrow(/requestId/);
    await expect(recordPayoutCore(db, parentAuth, { ...base, requestId: '../credit_inv1' })).rejects.toThrow(/requestId/);
    await expect(recordPayoutCore(db, parentAuth, { ...base, requestId: 'req-0005', kidId: 'k1/../k2' })).rejects.toThrow(/kidId/);
    await expect(recordPayoutCore(db, parentAuth, { ...base, requestId: 'req-0005', balance: 'pocket' as never })).rejects.toThrow(/balance/);
    await expect(recordPayoutCore(db, parentAuth, { ...base, requestId: 'req-0005', note: 'x'.repeat(501) })).rejects.toThrow(/note/);
    expect((await db.doc('families/fam1/kids/k1').get()).get('spendableBalance')).toBe(7000);
  });
});
```

`functions/src/deductionRules.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { setDeductionRulesCore } from './deductionRules.js';

let db: Firestore;
const parentAuth = { uid: 'p1', token: {} } as never;

beforeAll(() => {
  process.env.GCLOUD_PROJECT = 'money-kids-test';
  if (getApps().length === 0) initializeApp({ projectId: 'money-kids-test' });
  db = getFirestore();
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('families').doc('fam1'));
  await db.doc('families/fam1').set({ name: 'T', language: 'es', currency: 'COP', createdBy: 'p1', deductionRules: [] });
  await db.doc('families/fam1/members/p1').set({ role: 'parent', displayName: 'Leo' });
});

describe('setDeductionRulesCore', () => {
  it('writes valid rules', async () => {
    await setDeductionRulesCore(db, parentAuth, {
      familyId: 'fam1',
      rules: [{ nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000, destination: 'savings' }],
    });
    const fam = await db.doc('families/fam1').get();
    expect(fam.get('deductionRules')).toHaveLength(1);
  });
  it('rejects invalid rules and non-members', async () => {
    await expect(setDeductionRulesCore(db, parentAuth, {
      familyId: 'fam1',
      rules: [{ nameEs: 'X', nameEn: 'X', basisPoints: 10001, destination: 'withheld' }],
    })).rejects.toThrow(/exceed/i);
    await expect(setDeductionRulesCore(db, { uid: 'stranger', token: {} } as never, { familyId: 'fam1', rules: [] })).rejects.toThrow();
  });
  it('rejects a real parent of another family and malformed familyId', async () => {
    await db.doc('families/fam2').set({ name: 'Other', language: 'en', currency: 'USD', createdBy: 'p2', deductionRules: [] });
    await db.doc('families/fam2/members/p2').set({ role: 'parent', displayName: 'Ana' });
    await expect(setDeductionRulesCore(db, { uid: 'p2', token: {} } as never, {
      familyId: 'fam1',
      rules: [{ nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 9000, destination: 'savings' }],
    })).rejects.toThrow(/not a member/i);
    expect((await db.doc('families/fam1').get()).get('deductionRules')).toEqual([]);
    await expect(setDeductionRulesCore(db, parentAuth, { familyId: 'fam1/../fam2', rules: [] }))
      .rejects.toThrow(/familyId/);
    await db.recursiveDelete(db.collection('families').doc('fam2'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`functions/src/payout.ts`:
```ts
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { validateId, validateRequestId, validateNote, validateBalance } from '@money-kids/shared';
import { checked, assertParentCaller, type CallerAuth } from './auth.js';

export async function recordPayoutCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: {
    familyId: string; kidId: string; balance: 'spendable' | 'savings';
    amount: number; note: string; requestId: string;
  },
): Promise<void> {
  // requestId is the highest-risk field here: it becomes part of the ledger
  // document ID, so an unvalidated value could target another ledger entry
  checked(() => {
    validateId(data.familyId, 'familyId');
    validateId(data.kidId, 'kidId');
    validateRequestId(data.requestId);
    validateNote(data.note);
    validateBalance(data.balance);
  });
  await assertParentCaller(db, data.familyId, auth);
  if (!Number.isInteger(data.amount) || data.amount <= 0) {
    throw new HttpsError('invalid-argument', 'amount must be a positive integer');
  }
  await db.runTransaction(async (tx) => {
    const payoutRef = db.doc(`families/${data.familyId}/ledger/payout_${data.requestId}`);
    const existing = await tx.get(payoutRef);
    if (existing.exists) {
      // full audit payload must match, including the caller — otherwise a
      // different parent's retry would get a misleading success for someone
      // else's recorded payout
      const identical = existing.get('kidId') === data.kidId
        && existing.get('balance') === data.balance
        && existing.get('amount') === data.amount
        && existing.get('note') === data.note
        && existing.get('createdBy') === auth!.uid;
      if (identical) return; // idempotent retry: already recorded, no double debit
      throw new HttpsError('already-exists', 'requestId reused with mismatched payload');
    }
    const kidRef = db.doc(`families/${data.familyId}/kids/${data.kidId}`);
    const kid = await tx.get(kidRef);
    if (!kid.exists) throw new HttpsError('not-found', 'kid not found');
    const field = data.balance === 'spendable' ? 'spendableBalance' : 'savingsBalance';
    const current: number = kid.get(field) ?? 0;
    if (data.amount > current) {
      throw new HttpsError('failed-precondition', `payout exceeds ${data.balance} balance`);
    }
    tx.create(payoutRef, {
      kidId: data.kidId, type: 'payout', balance: data.balance, amount: data.amount,
      note: data.note, createdBy: auth!.uid, at: FieldValue.serverTimestamp(),
    });
    tx.update(kidRef, { [field]: FieldValue.increment(-data.amount) });
  });
}
```

`functions/src/deductionRules.ts`:
```ts
import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { validateDeductionRules, validateId, type DeductionRule } from '@money-kids/shared';
import { checked, assertParentCaller, type CallerAuth } from './auth.js';

export async function setDeductionRulesCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { familyId: string; rules: DeductionRule[] },
): Promise<void> {
  checked(() => validateId(data.familyId, 'familyId'));
  await assertParentCaller(db, data.familyId, auth);
  try {
    validateDeductionRules(data.rules);
  } catch (e) {
    throw new HttpsError('invalid-argument', (e as Error).message);
  }
  await db.doc(`families/${data.familyId}`).update({ deductionRules: data.rules });
}
```

Add to `functions/src/index.ts`:
```ts
import { recordPayoutCore } from './payout.js';
import { setDeductionRulesCore } from './deductionRules.js';

export const recordPayout = onCall(async (req) =>
  recordPayoutCore(getFirestore(), req.auth, req.data));

export const setDeductionRules = onCall(async (req) =>
  setDeductionRulesCore(getFirestore(), req.auth, req.data));
```

- [ ] **Step 4: Run all test suites**

Run: `npm run typecheck && npm test -w @money-kids/shared && npm run test:rules && npm run test:functions`
Expected: everything PASSES, with no type errors in any workspace. Also `npm run build -w @money-kids/functions` succeeds.

- [ ] **Step 5: Commit**

```bash
git add functions
git commit -m "feat(functions): idempotent payouts and validated deduction rules"
```

---

## What comes after this plan

- **Plan 2 — Parent experience:** React app shell, auth/onboarding, family creation, parent invites (extends member rules), activity board + starter catalog (ES/EN), invoice inbox with approve/counter/return, payout UI, deduction settings.
- **Plan 3 — Kid experience & polish:** kid join flow, invoice builder with photo compression + drafts, age-mode presets, balances/pay-stub views, i18n, PWA install, Playwright e2e.
