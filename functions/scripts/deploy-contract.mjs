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
