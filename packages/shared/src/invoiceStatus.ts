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
const TRANSITION_MAP = {
  'draft->sent': ['kid'],
  'sent->approved': ['server'],
  'sent->countered': ['parent'],
  'sent->returned': ['parent'],
  'returned->sent': ['kid'],
  'countered->approved': ['server'],
  'countered->sent': ['kid'],
} as const satisfies Partial<Record<`${InvoiceStatus}->${InvoiceStatus}`, readonly Actor[]>>;

/**
 * The same table as an array, for the conformance suites to iterate.
 *
 * Declared as a keyed map above rather than directly as an array so that a
 * duplicate from->to entry is a TypeScript error at the point it is written.
 * As a bare array, a second 'sent->approved' naming 'parent' would silently
 * widen who may approve — canTransition is `.some(...)` — and the rules
 * conformance matrix would then assert the new permission rather than flag it.
 * The runtime uniqueness test remains as a backstop, but the compiler catches
 * it first, without anyone needing to run the suite.
 */
export const TRANSITIONS: readonly { from: InvoiceStatus; to: InvoiceStatus; actors: readonly Actor[] }[] =
  Object.entries(TRANSITION_MAP).map(([pair, actors]) => {
    const [from, to] = pair.split('->') as [InvoiceStatus, InvoiceStatus];
    return { from, to, actors };
  });

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

