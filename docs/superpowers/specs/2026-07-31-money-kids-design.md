# Money Kids — Design Spec

**Date:** 2026-07-31
**Status:** Approved design, pending implementation plan

## What it is

A bilingual (Spanish/English) mobile-first PWA that teaches kids about money by replacing passive allowance with **invoicing**: kids do valuable activities — learning, facing fears, bringing useful ideas, helping — and send invoices to their parents, who review, negotiate, and approve them. Approved amounts accrue to an in-app balance that parents pay out in real life.

It is a product for many families (multi-tenant), not a single-family tool.

## Core concept

- **Parents post activities** with suggested prices (a "job board"), seeded from a bilingual starter catalog organized in four pillars: **Learn** (read a book together, explain what you learned), **Courage** (do something that scared you), **Ideas** (bring a thought-through, useful idea), **Help** (useful contributions at home). Activities can be one-time or repeatable.
- **Kids send invoices** either against a posted activity (price pre-filled) or **free-form** (kid picks category, writes description, sets their own price). Free-form is where kid initiative lives.
- **Photos are core evidence**: kids attach photos to invoices (the book they read, the drawing of their idea). Compressed client-side (~1200px) before upload.
- **Parents review** each invoice: **Approve** (credits balance), **Counter-offer** (different amount + note; the kid either accepts the new amount, which approves the invoice, or edits the invoice to justify their price and resends), or **Return with feedback** (kid edits and resends). Rejections are always feedback, never a dead end.
- **Ledger, not payments.** Approvals credit a per-kid balance. Parents pay out in real life and record the payout, which debits the ledger. No money moves inside the app in v1.
- **Deductions teach real finance.** Families can configure **deduction rules** — named percentages applied when an invoice is approved, e.g. "Family tax 10%", "Savings 20%". Each rule has a destination: **savings** (credits the kid's separate savings balance) or **withheld** (gone, like a real tax or fee). The approved invoice shows the full breakdown: gross amount, each deduction as a line item, and the net credited to the spendable balance. Deductions are off by default, with a one-tap starter preset ("Savings 20% + Family tax 10%"), and can be disabled per kid (recommended off for the 5–8 mode until the kid is ready).
- **Money representation:** each family has an ISO 4217 currency (e.g. COP, USD) set at creation. All amounts are signed integers in minor units (cents; COP has 0 minor digits). Payouts may be partial, specify which balance they draw from (spendable or savings), and must satisfy `0 < payout ≤ that balance` — no negative balances in v1.

The invoice loop itself is the teaching — no lesson library in v1.

## Accounts & family structure

- A **family** is the core unit. One parent signs up (email or Google via Firebase Auth) and creates it, and can invite **any number of additional parents/caregivers** by email (grandparents, etc.). All parents share the same invoice inbox and activity board: every parent sees all pending and resolved invoices, badge counts, and who reviewed what — each approval, counter-offer, payout, and activity records the acting parent's ID, shown in the UI.
- Parents create **kid profiles** (name, avatar, birth year → age mode). Kids need no email.
- **Kid device sessions:** each kid has a join code / QR. A Cloud Function validates the code and mints a Firebase **custom auth token** for a **stable Auth UID** (`kid_{kidId}`) with `familyId`, `kidId`, `role: kid` claims. Codes expire and are revocable from parent settings. Revoking a kid's access calls `revokeRefreshTokens()` on that UID (not just the code): the device cannot refresh again, and any already-issued ID token expires within its normal ≤1-hour lifetime — that is the documented maximum residual access window.
- **Profile switcher on a parent's phone:** kid can use the parent's device; switching back to parent view requires a parent PIN. **Threat model:** the PIN is a UI convenience lock against casual misuse (a kid tapping into the parent view), not a backend authorization boundary — the parent's Firebase session remains active on the device. Real deterrents for misuse of a live parent session are the append-only ledger and every approval being visible to all parents. Requiring Firebase reauthentication for approvals/payouts is explicitly deferred past v1.
- Roles: **parent** (post activities, review invoices, record payouts, manage kids/settings) and **kid** (browse activities, create/edit own invoices, view own balance and history).

## Tech stack

- **Frontend:** React + Vite PWA (installable, mobile-first, bottom-tab navigation), deployed on Firebase Hosting.
- **Backend:** Firebase — Auth, Firestore, Storage, and a small set of **callable Cloud Functions** for the money-critical mutations: kid join-code token minting, kid-access revocation, invoice approval (including counter-offer acceptance), and payout recording. All other reads/writes go directly from the client under security rules.
- **i18n:** react-i18next; ES and EN from day one. Family default language, switchable per device. Starter catalog authored in both languages.

## Data model (Firestore)

All data nests under the family document so security rules reduce to "only your own family":

- `families/{familyId}` — name, language preference, currency (ISO 4217), createdBy, deduction rules `[{name (ES/EN), basisPoints, destination: savings | withheld}]`. Rules are validated on write: each `basisPoints` is a non-negative integer, and the sum across rules is ≤ 10000 (100%) — net can never go negative. Rules are **snapshotted at approval**: the approval function computes the breakdown from the rules current at that moment, which is exactly what the parent sees on the review screen before confirming; changing family rules never affects already-approved invoices.
- `families/{familyId}/members/{userId}` — role (parent), display name
- `families/{familyId}/kids/{kidId}` — name, avatar, birth year, age-mode override, deductions-enabled flag, spendable balance and savings balance (minor units)
- `families/{familyId}/activities/{activityId}` — title, description, suggested price, category, repeatable flag, active flag
- `families/{familyId}/invoices/{invoiceId}` — kidId, optional activityId, description, photo refs, status, and an immutable money/audit record: `requestedAmount` (the kid's current ask — initial value immutable in events, revisable on resend per the transition matrix), optional `counterOffer {amount, note, parentId, at}`, `approvedAmount` (gross, set only at approval), `deductions [{name, basisPoints, amount, destination}]` and `netAmount` (both computed at approval from the family's rules, frozen on the invoice), and an append-only `events` array where every transition records `{from, to, actorUid, at, note}`
- `families/{familyId}/ledger/{entryId}` — kidId, type (credit | savings-credit | payout), **balance (spendable | savings)** — the balance the entry credited or debited, so history is fully reconstructible — amount (always positive; type determines direction), linked invoiceId (credits), note (payouts), createdBy, timestamp. Credits carry `balance: spendable`, savings-credits `balance: savings`, payouts whichever balance they drew from.

**Invoice status machine:** `draft → sent → approved | countered | returned`; `returned → sent` (edit + resend); `countered → approved` (kid accepts) or `countered → sent` (kid edits and resends); approved amounts are later covered by `payout` ledger entries. Drafts are Firestore documents (status `draft`), created before any photo upload — so drafts survive device loss and Storage rules can authorize uploads against an existing invoice doc.

**Transition & field matrix (rule-enforced):**

| Status | Who may act | Editable fields | Allowed transitions |
|---|---|---|---|
| `draft` | owning kid | description, photos, requestedAmount, activityId | → `sent` (kid); kid may **delete** the draft |
| `sent` | parent only | none (kid edits require going through `returned`/`countered`) | → `approved` (function), `countered` (parent), `returned` (parent) |
| `returned` | owning kid | description, photos, requestedAmount | → `sent` (kid) |
| `countered` | owning kid | description, photos, requestedAmount (to justify price) | → `approved` (function, kid accepts), `sent` (kid resends) |
| `approved` | nobody | none — terminal and immutable | none |

The **initial** `requestedAmount` (first send) is immutable; revisions on resend are permitted but every `sent` transition snapshots the then-current amount into the `events` entry, so the negotiation history is fully reconstructible. Rules require every client-written event's `actorUid == request.auth.uid` and `at == request.time` — actors and timestamps are server-derived, never client-claimed; approval events are written by the Cloud Function. **Deletion is allowed only for `draft` invoices by the owning kid**; `sent` and later invoices can never be deleted, so ledger history always resolves.

**One-time activities:** "one-time" means **once per kid**. **Duplicate pending invoices are allowed by design** — a kid bypassing the UI can submit several against the same one-time activity, which creates review noise but never duplicate money: the only enforced invariant is in the approval Cloud Function, which rejects approving a one-time activity for a kid who already has an approved invoice against it. The client hides already-used one-time activities as a courtesy, and the parent resolves any duplicates in review (approve one, return the rest with feedback). No claim-reservation system in v1.

**Ledger integrity (server-authoritative):** approvals and payouts are performed only by callable Cloud Functions running a Firestore transaction: approval verifies the invoice is in an approvable state, computes deductions from the family's rules (integer minor-unit math, largest-remainder rounding so line items always sum exactly to gross), freezes `approvedAmount`/`deductions`/`netAmount` on the invoice, writes the spendable credit with the **deterministic ID `credit_{invoiceId}`** and any savings credit as `savings_{invoiceId}` (both create-only — duplicate credits are structurally impossible), and updates the kid's balances atomically. Payout specifies which balance it draws from (spendable or savings), verifies `0 < amount ≤ that balance`, appends a payout entry, and debits it. Security rules deny all client writes to `ledger`, to `kids.*.balance`, and to invoice status transitions into `approved`. Ledger entries are append-only.

**Photos:** Firebase Storage under `families/{familyId}/kids/{kidId}/invoices/{invoiceId}/`. **Reads:** parents may read any path in their family; kid sessions may read only paths whose `{kidId}` segment matches their `kidId` claim — siblings cannot see each other's photos. **Writes/deletes:** only the matching kid session (or a family parent), only while the linked invoice is editable per the matrix above (kid-editable states: `draft`, `returned`, `countered`), with limits of 5 MB per file and `image/*` content types. The client reserves the Firestore auto-ID by creating the `draft` invoice doc before uploading.

## UI & age modes

Two experiences in one app:

- **Parent view:** invoice inbox (badge count), activity board management, per-kid balances, payout recording, family settings.
- **Kid view:** activity board ("ways to earn"), prominent "New invoice" button, big celebratory balance display (spendable + savings when deductions are on), invoice history with statuses. Approved invoices show the gross → deductions → net breakdown like a real pay stub, with kid-friendly explanations of each line.

**Age modes** are presets of the same kid screens, set by birth year, overridable per kid:

- **5–8:** minimal text, big tap targets, icon/emoji pickers, photo-first invoices instead of typing, amounts shown as coins/bills imagery.
- **8–12:** short text fields with prompts ("What did you learn? One sentence is fine"), full invoice flow.
- **12–16:** denser layout, negotiation emphasized (counter-offers, justifying price through better descriptions), earnings stats.

**Tone:** playful but not babyish — the app treats kids as professionals sending real invoices. Approval triggers a small celebration animation.

## Security

- Firestore rules: parents read/write only their own family. Kid sessions can create/edit only their own invoices in the kid-editable states of the transition matrix (`draft`, `returned`, `countered`); kids can never write balances, ledger entries, or other kids' data.
- **Money mutations are server-only:** rules deny all client writes to `ledger`, kid balances, and invoice transitions into `approved`; those happen exclusively through the callable Cloud Functions (see Data model).
- **Callable functions have their own authorization contract** — the Admin SDK bypasses Firestore rules, so rules protect nothing inside a function. Every callable (approval, payout, join-code minting, kid revocation) must independently verify, from its own auth context: the caller is an authenticated member of the target family with the required role, and every target ID (invoice, kid, activity) belongs to that same family. Required role is parent for approval, payout, join-code minting, and revocation — with one exception: **counter-offer acceptance** may be called by the owning kid (matching `kidId` claim), and it approves strictly at the parent's recorded `counterOffer.amount`, which the parent pre-authorized when countering. Cross-family and wrong-role calls are rejected, and emulator tests must cover both rejections for each function.
- **Query rules are explicit, not implicit:** Firestore rules do not filter query results, so kid reads of `invoices` and `ledger` are only allowed for queries constrained by `kidId == request.auth.token.kidId` (rules check `resource.data.kidId` on reads); a kid querying the whole collection fails. Kids may read the family's `activities` and their own `kids/{kidId}` doc only. Emulator tests must prove the broad queries fail.
- Join codes expire and are revocable; revocation also revokes the kid UID's refresh tokens (≤1-hour residual window, see Accounts).

## Error handling

- Photo uploads retry with visible progress; the invoice already exists as a **draft** doc before uploads start, so a kid's work is never lost to a failed upload.
- Firestore offline persistence: kids can draft invoices offline; they sync later. (Approvals/payouts are callable functions and require a connection — acceptable, since parents review deliberately.)
- Double-approval is structurally impossible: the approval function's transaction checks invoice status, and the ledger credit's deterministic ID (`credit_{invoiceId}`) is create-only.

## Testing

- **Vitest** unit tests for the invoice state machine and ledger math, including deduction computation (basis points over minor units, largest-remainder rounding, line items summing exactly to gross, sum-cap validation).
- **Firebase emulator** tests for security rules and the approval/payout Cloud Functions (safety-critical: kids must never be able to credit themselves; client writes to ledger/balances must fail; unconstrained kid queries must fail; duplicate approval must fail; payout over balance must fail).
- **Playwright** mobile-viewport e2e: sign up → add kid → kid sends invoice with photo → parent approves → balance updates → payout.

## Out of scope for v1 (fast-follows and later phases)

- Real money transfers / payment integration
- Push notifications (v1 uses in-app badge counts)
- Micro-lessons or curriculum content
- Savings **goals** (targets like "save for a bike" with progress tracking — the savings *balance* from deductions is in v1, goals on top of it are not)
- Voice notes for the 5–8 mode (photo + tap ships first)
- Native mobile apps
