import { describe, it, expect } from 'vitest';
import { ACTORS, INVOICE_STATUSES, KID_EDITABLE, TRANSITIONS, canTransition } from './invoiceStatus.js';

describe('canTransition', () => {
  it.each([
    ['draft', 'sent', 'kid', true],
    ['sent', 'approved', 'server', true],
    ['sent', 'countered', 'parent', true],
    ['sent', 'returned', 'parent', true],
    ['returned', 'sent', 'kid', true],
    ['countered', 'approved', 'server', true],
    ['countered', 'sent', 'kid', true],
    // forbidden
    ['sent', 'approved', 'parent', false], // approval is server-only
    ['sent', 'approved', 'kid', false],
    ['draft', 'approved', 'server', false],
    ['approved', 'sent', 'kid', false], // approved is terminal
    ['approved', 'returned', 'parent', false],
    ['draft', 'sent', 'parent', false],
    ['sent', 'returned', 'kid', false],
  ] as const)('%s -> %s as %s = %s', (from, to, actor, ok) => {
    expect(canTransition(from, to, actor)).toBe(ok);
  });
});

describe('KID_EDITABLE', () => {
  it('is exactly draft, returned, countered', () => {
    expect([...KID_EDITABLE].sort()).toEqual(['countered', 'draft', 'returned']);
  });
});

describe('the transition table is well-formed', () => {
  // canTransition is `.some(...)`, so a duplicate from->to entry silently
  // widens who may perform it — and the rules conformance matrix would then
  // assert the NEW permission rather than flag it. The old Record literal made
  // duplicate keys a type error; as an array, nothing does but this.
  it('has no duplicate from->to pairs', () => {
    const pairs = TRANSITIONS.map((t) => `${t.from}->${t.to}`);
    expect(pairs).toEqual([...new Set(pairs)]);
  });

  it('only references statuses and actors that exist', () => {
    for (const { from, to, actors } of TRANSITIONS) {
      expect(INVOICE_STATUSES).toContain(from);
      expect(INVOICE_STATUSES).toContain(to);
      expect(actors.length).toBeGreaterThan(0);
      for (const actor of actors) expect(ACTORS).toContain(actor);
    }
  });

  it('never permits a transition to the same status', () => {
    // The event rules reject from == to outright, so such an entry would be
    // permanently unperformable.
    expect(TRANSITIONS.filter((t) => t.from === t.to)).toEqual([]);
  });

  it('lets a kid edit exactly draft, returned and countered invoices', () => {
    // Deliberately a literal, not a derivation. KID_EDITABLE *is*
    // `filter(canTransition(_, 'sent', 'kid'))`, so asserting that equality
    // would restate the implementation and could never fail. This pins the
    // product decision instead: changing which invoices a kid may still edit
    // has to be a deliberate edit here, not a side effect of touching the
    // transition table.
    expect([...KID_EDITABLE].sort()).toEqual(['countered', 'draft', 'returned']);
  });
});
