// The deploy contract: what the staged artifact must contain, and what Cloud
// Build is allowed to install. Both halves live here so there is one file to
// edit, and it is imported by stage.mjs (build-time checks) and smoke.mjs
// (post-build load check) rather than shipped inside the deployed artifact.

// Exactly these callables must exist in the bundle.
//
// Pinned here rather than derived from src/index.ts, because deriving both
// sides from the same file means deleting an export shrinks the expected set
// too and the check passes — while the callable deploys as a deleted function.
// Adding or removing a callable is a deliberate edit to this list.
export const EXPECTED_CALLABLES = [
  'acceptCounterOffer',
  'acceptParentInvite',
  'approveInvoice',
  'createJoinCode',
  'createParentInvite',
  'mintKidToken',
  'recordPayout',
  'revokeKidAccess',
  'setDeductionRules',
];

// Anything NOT listed here must be inlined into the bundle. Adding an entry
// means Cloud Build has to install it, so it must be published on npm and
// declared in functions/package.json.
export const EXTERNALS = ['firebase-admin', 'firebase-functions'];

// Every module from packages/shared that the bundle pulls in must contribute
// bytes to the output. Checking shared in aggregate would pass while money.ts
// specifically — the minor-unit arithmetic every balance depends on — had been
// tree-shaken away or reduced to a stub.
//
// Inverted deliberately: a new packages/shared/src/deductions.ts carrying
// money arithmetic is guarded the day it is written, rather than the day
// someone remembers to add it to a list. Barrels and type-only modules
// legitimately contribute nothing, so they opt out here.
export const SHARED_MODULES_EXEMPT_FROM_BYTES = [
  'src/index.ts', // re-export barrel: contributes no code of its own
  // The invoice state machine is consumed by the app and the rules tests; no
  // callable imports it, so it is parsed through the barrel and then dropped.
  // Tracked in #7: the callables enforce transitions with their own inline
  // checks instead. When that is unified, remove this line so the guard covers
  // it.
  'src/invoiceStatus.ts',
];

// Always checked even if nothing imports them, so deleting the last caller of
// the money helpers cannot quietly drop them from the bundle.
export const REQUIRED_SHARED_MODULES = ['src/money.ts'];

// Inlined rather than installed: bundled at build time, so it must never
// appear in the generated manifest. Also the alias target, so one edit here
// drives resolution, the first-party allow-list and the manifest check.
export const INLINED_WORKSPACE_PACKAGE = '@money-kids/shared';

// Packages on the ledger path. The root lockfile governs what `test:functions`
// runs against; deploy.lock.json governs what production runs. They resolve
// independently, so a behavioural change in any of these would be untested by
// the suite that guards the money callables. Divergence here fails the build;
// divergence elsewhere is reported.
export const MONEY_CRITICAL_PACKAGES = [
  'firebase-admin',
  'firebase-functions',
  '@google-cloud/firestore',
  '@grpc/grpc-js',
];
