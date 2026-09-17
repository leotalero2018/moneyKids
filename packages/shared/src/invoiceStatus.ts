export type InvoiceStatus = 'draft' | 'sent' | 'approved' | 'countered' | 'returned';
export type Actor = 'kid' | 'parent' | 'server';

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'draft',
  'sent',
  'approved',
  'countered',
  'returned',
];

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

export const KID_EDITABLE: readonly InvoiceStatus[] = ['draft', 'returned', 'countered'];

export function canTransition(from: InvoiceStatus, to: InvoiceStatus, actor: Actor): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to && t.actors.includes(actor));
}
