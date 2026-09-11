// The deploy contract: exactly these callables must exist in the bundle.
//
// Pinned here rather than derived from src/index.ts, because deriving both
// sides from the same file means deleting an export shrinks the expected set
// too and the check passes — while the callable deploys as a deleted function.
// Adding or removing a callable is a deliberate edit to this list.
//
// Imported by both stage.mjs (build-time export-surface check) and smoke.mjs
// (post-install load check), so the contract is not shipped inside the
// deployed artifact.
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
