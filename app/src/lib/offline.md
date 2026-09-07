# Offline drafting — where it is tested, and why not here

There used to be `offline.test.ts` in this directory, exercising
`disableNetwork` / `enableNetwork` against the emulator in jsdom. It was
deleted deliberately.

**Why it went:** cycling the network on a Firestore 10.x client trips an SDK
bug — `INTERNAL ASSERTION FAILED: Unexpected state` in `PersistentWriteStream`
— which surfaces as unhandled rejections *after* the test finishes. The
assertions passed; the process exited non-zero. Suppressing unhandled
rejections suite-wide to hide it would have blinded every other test to the
real ones.

**What it was worth:** less than it looked. jsdom has no IndexedDB, so that
test ran on the memory cache and could prove queueing and sync but never
persistence across a reload — the actual promise the spec makes to a kid with
no signal.

**Where offline is tested now:** `e2e/invoice-loop.spec.ts` →
*"a draft written offline survives a reload and syncs"*. Real browser, real
IndexedDB, real reload, and it runs in CI on every PR. It covers strictly more
than the deleted test did.

The unit-level guarantee that makes offline drafting possible at all —
`createDraft` returning an id without awaiting the server — is still covered
in `kidInvoice.test.ts`.
