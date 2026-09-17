// The array is the declaration and the union is derived from it, so a new
// status cannot be added to one and forgotten in the other — the conformance
// matrices iterate INVOICE_STATUSES, and a partially populated list would
// silently stop covering it.
export const INVOICE_STATUSES = ['draft', 'sent', 'approved', 'countered', 'returned'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const ACTORS = ['kid', 'parent', 'server'] as const;
export type Actor = (typeof ACTORS)[number];

/**
 * The invoice state machine — the single source of truth for who may move an
 * invoice from one status to another.
 *
 * This is enforced in three places, and they must not drift: the Firestore
 * rules (which govern what the app can write directly), the callables (which
 * bypass rules entirely and are the only path that credits a balance), and the
 * app's own UI. Exported as data so tests can assert all three agree with it
 * rather than each re-stating the rules in prose.
 */
export const TRANSITIONS: readonly { from: InvoiceStatus; to: InvoiceStatus; actors: readonly Actor[] }[] = [
  { from: 'draft', to: 'sent', actors: ['kid'] },
  { from: 'sent', to: 'approved', actors: ['server'] },
  { from: 'sent', to: 'countered', actors: ['parent'] },
  { from: 'sent', to: 'returned', actors: ['parent'] },
  { from: 'returned', to: 'sent', actors: ['kid'] },
  { from: 'countered', to: 'approved', actors: ['server'] },
  { from: 'countered', to: 'sent', actors: ['kid'] },
];

export function canTransition(from: InvoiceStatus, to: InvoiceStatus, actor: Actor): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to && t.actors.includes(actor));
}

/**
 * Statuses a kid may still edit — exactly those they can send from, since
 * editing is only meaningful on an invoice that has not yet gone to a parent.
 * Derived rather than restated: a second literal list here would drift from
 * TRANSITIONS the same way the callables and the rules did.
 */
export const KID_EDITABLE: readonly InvoiceStatus[] = INVOICE_STATUSES.filter((from) =>
  canTransition(from, 'sent', 'kid'),
);

