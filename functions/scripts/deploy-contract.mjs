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

// Which packages/shared modules may contribute zero bytes to the bundle.
//
// The guard is inverted on purpose: every shared module esbuild parses must
// contribute bytes unless it is listed below, so a new
// packages/shared/src/deductions.ts carrying money arithmetic is protected the
// day it is written rather than the day someone remembers to list it.

// Legitimately empty and expected to be: barrels and type-only files.
// Exempted silently.
export const SHARED_BARRELS_AND_TYPES = ['src/index.ts'];

// Modules that are absent from the bundle because the callables re-implement
// what they hold. Each prints a warning on every build: this is a divergence
// to be closed, not a fact to be filed away, and the next person should not
// read the exemption as "fine to be absent".
export const SHARED_KNOWN_DIVERGENT = [
  {
    module: 'src/invoiceStatus.ts',
    why: 'the invoice state machine (canTransition) is used by the app and the rules tests, while the callables enforce transitions with inline status comparisons — the same rule in three places with no shared source of truth',
    issue: '#7',
  },
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
