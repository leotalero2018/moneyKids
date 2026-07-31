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

The invoice loop itself is the teaching — no lesson library in v1.

## Accounts & family structure

- A **family** is the core unit. One parent signs up (email or Google via Firebase Auth) and creates it; can invite a second parent by email.
- Parents create **kid profiles** (name, avatar, birth year → age mode). Kids need no email.
- **Kid device sessions:** each kid has a join code / QR. A Cloud Function validates the code and mints a Firebase **custom auth token** with `familyId`, `kidId`, `role: kid` claims. Codes expire and are revocable from parent settings.
- **Profile switcher on a parent's phone:** kid can use the parent's device; switching back to parent view requires a parent PIN.
- Roles: **parent** (post activities, review invoices, record payouts, manage kids/settings) and **kid** (browse activities, create/edit own invoices, view own balance and history).

## Tech stack

- **Frontend:** React + Vite PWA (installable, mobile-first, bottom-tab navigation), deployed on Firebase Hosting.
- **Backend:** Firebase — Auth, Firestore, Storage, one small Cloud Function (kid join-code token minting).
- **i18n:** react-i18next; ES and EN from day one. Family default language, switchable per device. Starter catalog authored in both languages.

## Data model (Firestore)

All data nests under the family document so security rules reduce to "only your own family":

- `families/{familyId}` — name, language preference, createdBy
- `families/{familyId}/members/{userId}` — role (parent), display name
- `families/{familyId}/kids/{kidId}` — name, avatar, birth year, age-mode override, current balance
- `families/{familyId}/activities/{activityId}` — title, description, suggested price, category, repeatable flag, active flag
- `families/{familyId}/invoices/{invoiceId}` — kidId, optional activityId, description, photo refs, amount, status, status-change history with notes
- `families/{familyId}/ledger/{entryId}` — kidId, type (credit | payout), amount, linked invoiceId, timestamp

**Invoice status machine:** `sent → approved | countered | returned`; `returned → sent` (edit + resend); `countered → approved` (kid accepts) or `countered → sent` (kid edits and resends); approved amounts are later covered by a `payout` ledger entry. Drafts (unsent, e.g. after a failed upload) exist client-side as status `draft → sent`.

**Ledger integrity:** the kid's `balance` is updated in the same **batched write** that sets the invoice to approved and appends the ledger credit entry — balance and ledger cannot drift. Ledger entries are append-only.

**Photos:** Firebase Storage under `families/{familyId}/invoices/{invoiceId}/`, readable only by the family (Storage rules mirror Firestore rules).

## UI & age modes

Two experiences in one app:

- **Parent view:** invoice inbox (badge count), activity board management, per-kid balances, payout recording, family settings.
- **Kid view:** activity board ("ways to earn"), prominent "New invoice" button, big celebratory balance display, invoice history with statuses.

**Age modes** are presets of the same kid screens, set by birth year, overridable per kid:

- **5–8:** minimal text, big tap targets, icon/emoji pickers, photo-first invoices instead of typing, amounts shown as coins/bills imagery.
- **8–12:** short text fields with prompts ("What did you learn? One sentence is fine"), full invoice flow.
- **12–16:** denser layout, negotiation emphasized (counter-offers, justifying price through better descriptions), earnings stats.

**Tone:** playful but not babyish — the app treats kids as professionals sending real invoices. Approval triggers a small celebration animation.

## Security

- Firestore rules: parents read/write only their own family. Kid sessions can create/edit only their own invoices while status is `sent` or `returned`; kids can never write balances, ledger entries, or other kids' data.
- Approval batched writes are validated by rules (status change + ledger entry + balance update must be consistent).
- Join codes expire and are revocable.

## Error handling

- Photo uploads retry with visible progress; on failure the invoice is saved as a **draft** so a kid's work is never lost.
- Firestore offline persistence: kids can draft invoices offline; they sync later.
- Double-approval is guarded by checking invoice status inside the batched write.

## Testing

- **Vitest** unit tests for the invoice state machine and ledger math.
- **Firebase emulator** tests for security rules (safety-critical: kids must never be able to credit themselves).
- **Playwright** mobile-viewport e2e: sign up → add kid → kid sends invoice with photo → parent approves → balance updates → payout.

## Out of scope for v1 (fast-follows and later phases)

- Real money transfers / payment integration
- Push notifications (v1 uses in-app badge counts)
- Micro-lessons or curriculum content
- Savings goals
- Voice notes for the 5–8 mode (photo + tap ships first)
- Native mobile apps
