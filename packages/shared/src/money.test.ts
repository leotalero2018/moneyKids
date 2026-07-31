import { describe, it, expect } from 'vitest';
import { computeDeductions, validateDeductionRules, type DeductionRule } from './money.js';

const savings20: DeductionRule = { nameEs: 'Ahorro', nameEn: 'Savings', basisPoints: 2000, destination: 'savings' };
const tax10: DeductionRule = { nameEs: 'Impuesto familiar', nameEn: 'Family tax', basisPoints: 1000, destination: 'withheld' };

describe('validateDeductionRules', () => {
  it('accepts the starter preset', () => {
    expect(() => validateDeductionRules([savings20, tax10])).not.toThrow();
  });
  it('rejects negative basis points', () => {
    expect(() => validateDeductionRules([{ ...tax10, basisPoints: -1 }])).toThrow(/non-negative integer/);
  });
  it('rejects non-integer basis points', () => {
    expect(() => validateDeductionRules([{ ...tax10, basisPoints: 10.5 }])).toThrow(/non-negative integer/);
  });
  it('rejects sums above 100%', () => {
    expect(() => validateDeductionRules([savings20, { ...tax10, basisPoints: 8001 }])).toThrow(/exceed/);
  });
  it('accepts a sum of exactly 100%', () => {
    expect(() => validateDeductionRules([{ ...savings20, basisPoints: 10000 }])).not.toThrow();
  });
  it('rejects untrusted shapes at runtime (callable boundary)', () => {
    expect(() => validateDeductionRules('nope' as never)).toThrow(/array/);
    expect(() => validateDeductionRules([null as never])).toThrow(/object/);
    expect(() => validateDeductionRules([{ ...tax10, destination: 'pocket' as never }])).toThrow(/destination/);
    expect(() => validateDeductionRules([{ ...tax10, nameEs: '' }])).toThrow(/name/);
    expect(() => validateDeductionRules([{ ...tax10, nameEn: 'x'.repeat(61) }])).toThrow(/name/);
    expect(() => validateDeductionRules([{ ...tax10, basisPoints: '10' as never }])).toThrow(/non-negative integer/);
    expect(() => validateDeductionRules(new Array(21).fill(tax10))).toThrow(/too many/i);
  });
});

describe('computeDeductions', () => {
  it('computes the starter preset on a round amount', () => {
    const b = computeDeductions(10000, [savings20, tax10]);
    expect(b.lines.map((l) => l.amount)).toEqual([2000, 1000]);
    expect(b.savingsTotal).toBe(2000);
    expect(b.withheldTotal).toBe(1000);
    expect(b.netAmount).toBe(7000);
  });
  it('net + deductions always equals gross (rounding)', () => {
    // 3 rules that don't divide evenly: 33.33% x3 of 100
    const third: DeductionRule = { nameEs: 'A', nameEn: 'A', basisPoints: 3333, destination: 'withheld' };
    const b = computeDeductions(100, [third, third, third]);
    const total = b.lines.reduce((s, l) => s + l.amount, 0);
    expect(b.netAmount + total).toBe(100);
    // largest-remainder: floor(33.33)=33 each, target floor(99.99)=99 → no extra cent
    expect(b.lines.map((l) => l.amount)).toEqual([33, 33, 33]);
    expect(b.netAmount).toBe(1);
  });
  it('distributes remainder cents by largest fraction, ties by rule order', () => {
    const a: DeductionRule = { nameEs: 'a', nameEn: 'a', basisPoints: 2500, destination: 'withheld' };
    const b2: DeductionRule = { nameEs: 'b', nameEn: 'b', basisPoints: 2500, destination: 'withheld' };
    const r = computeDeductions(101, [a, b2]); // 25.25 each, target floor(50.5)=50
    expect(r.lines.map((l) => l.amount)).toEqual([25, 25]);
    expect(r.netAmount).toBe(51);
  });
  it('handles 100% deductions with zero net', () => {
    const b = computeDeductions(999, [{ ...savings20, basisPoints: 10000 }]);
    expect(b.netAmount).toBe(0);
    expect(b.savingsTotal).toBe(999);
  });
  it('returns empty breakdown for no rules', () => {
    const b = computeDeductions(500, []);
    expect(b.lines).toEqual([]);
    expect(b.netAmount).toBe(500);
  });
  it('rejects non-positive or fractional gross', () => {
    expect(() => computeDeductions(0, [])).toThrow(/positive integer/);
    expect(() => computeDeductions(10.5, [])).toThrow(/positive integer/);
  });
});
