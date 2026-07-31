export type InvoiceStatus = 'draft' | 'sent' | 'approved' | 'countered' | 'returned';
export type Actor = 'kid' | 'parent' | 'server';

const TRANSITIONS: Record<string, readonly Actor[]> = {
  'draft->sent': ['kid'],
  'sent->approved': ['server'],
  'sent->countered': ['parent'],
  'sent->returned': ['parent'],
  'returned->sent': ['kid'],
  'countered->approved': ['server'],
  'countered->sent': ['kid'],
};

export const KID_EDITABLE: readonly InvoiceStatus[] = ['draft', 'returned', 'countered'];

export function canTransition(from: InvoiceStatus, to: InvoiceStatus, actor: Actor): boolean {
  return TRANSITIONS[`${from}->${to}`]?.includes(actor) ?? false;
}
