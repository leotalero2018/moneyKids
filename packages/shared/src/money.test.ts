import { describe, it, expect } from 'vitest';
import {
  computeDeductions, validateDeductionRules, minorDigits, formatMinor, parseMajor,
  SUPPORTED_CURRENCIES,
  type DeductionRule,
} from './money.js';

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
  it('redistributes remainder to rule with largest fractional part', () => {
    // gross 3 with rules [6667bp, 3333bp]
    // raw: [2.0001, 0.9999], floors: [2, 0], target: 3, remainder: 1
    // largest fraction is 0.9999 (index 1) → gets the extra cent
    const a: DeductionRule = { nameEs: 'a', nameEn: 'a', basisPoints: 6667, destination: 'withheld' };
    const b: DeductionRule = { nameEs: 'b', nameEn: 'b', basisPoints: 3333, destination: 'withheld' };
    const r = computeDeductions(3, [a, b]);
    expect(r.lines.map((l) => l.amount)).toEqual([2, 1]);
    expect(r.netAmount).toBe(0);
  });
  it('breaks ties in remainder distribution by rule order', () => {
    // gross 150 with rules [2500bp, 2500bp]
    // raw: [37.5, 37.5], floors: [37, 37], target: 75, remainder: 1
    // both have equal fractions (0.5) → first rule gets the extra cent
    const a: DeductionRule = { nameEs: 'a', nameEn: 'a', basisPoints: 2500, destination: 'withheld' };
    const b: DeductionRule = { nameEs: 'b', nameEn: 'b', basisPoints: 2500, destination: 'withheld' };
    const r = computeDeductions(150, [a, b]);
    expect(r.lines.map((l) => l.amount)).toEqual([38, 37]);
    expect(r.netAmount).toBe(75);
  });
});

describe('minorDigits', () => {
  it('knows the zero-decimal and two-decimal currencies the app ships with', () => {
    expect(minorDigits('COP')).toBe(0);
    expect(minorDigits('USD')).toBe(2);
    expect(minorDigits('EUR')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
  });
  it('does not depend on the runtime ICU data', () => {
    // Intl's resolvedOptions().maximumFractionDigits answers 0 for COP on one
    // Node build and 2 on another, and the same split exists across browsers.
    // The scale of money cannot be a property of the device: on the wrong
    // answer, parseMajor('1234','COP') is 123400 — a 100x ledger error.
    const viaIntl = new Intl.NumberFormat('en', { style: 'currency', currency: 'COP' })
      .resolvedOptions().maximumFractionDigits;
    expect(minorDigits('COP')).toBe(0);
    expect(parseMajor('1234', 'COP')).toBe(1234);
    if (viaIntl !== 0) {
      // this runtime disagrees with us — which is exactly the case the table
      // exists for, so prove we ignored it rather than skipping the check
      expect(minorDigits('COP')).not.toBe(viaIntl);
    }
  });

  it('refuses a currency it has no scale for, rather than assuming 2', () => {
    expect(() => minorDigits('XYZ')).toThrow(/not supported/);
  });

  it('rejects malformed codes rather than guessing', () => {
    expect(() => minorDigits('')).toThrow(/currency/i);
    expect(() => minorDigits('usd')).toThrow(/currency/i);
    expect(() => minorDigits('DOLLARS')).toThrow(/currency/i);
  });
});

describe('formatMinor', () => {
  // Assert on digits, not on symbols or spacing: ICU output varies by
  // Node version, and a test pinned to '$1,234.00' will fail on an upgrade
  // for no real reason.
  it('scales by the currency, not by a fixed 100', () => {
    expect(formatMinor(1234, 'COP', 'es-CO')).toMatch(/1[.,\s]?234/);
    expect(formatMinor(1234, 'COP', 'es-CO')).not.toMatch(/12[.,]34/);
    expect(formatMinor(1234, 'USD', 'en-US')).toMatch(/12[.,]34/);
  });
  it('formats zero and rejects non-integers', () => {
    expect(formatMinor(0, 'USD', 'en-US')).toMatch(/0/);
    expect(() => formatMinor(12.5, 'USD', 'en-US')).toThrow(/integer/i);
  });
});

describe('parseMajor', () => {
  // Contract: a zero-decimal currency cannot have a decimal mark, so every
  // separator in it is grouping and is stripped. A two-decimal currency
  // accepts exactly one separator followed by 1-2 digits and nothing else —
  // '1,234' is REJECTED rather than guessed at, because grouping and decimal
  // marks are ambiguous across locales and this is money.
  it('converts major-unit input to minor units per currency', () => {
    expect(parseMajor('1234', 'COP')).toBe(1234);
    expect(parseMajor('12.34', 'USD')).toBe(1234);
    expect(parseMajor('12,34', 'USD')).toBe(1234);
    expect(parseMajor('12.3', 'USD')).toBe(1230);
    expect(parseMajor('12', 'USD')).toBe(1200);
    expect(parseMajor('0', 'USD')).toBe(0);
  });
  it('strips grouping in zero-decimal currencies, where it cannot be a decimal', () => {
    expect(parseMajor('  1.234  ', 'COP')).toBe(1234);
    expect(parseMajor('1,234,567', 'COP')).toBe(1234567);
  });
  it('rejects a decimal mark a zero-decimal currency cannot have', () => {
    expect(() => parseMajor('12.5', 'COP')).toThrow(/decimal/i);
  });
  it('rejects more decimals than the currency has, and ambiguous grouping', () => {
    expect(() => parseMajor('12.345', 'USD')).toThrow(/decimal/i);
    expect(() => parseMajor('1,234', 'USD')).toThrow(/decimal/i);
  });
  it('rejects negatives, blanks, and non-numeric text', () => {
    expect(() => parseMajor('-5', 'USD')).toThrow(/amount/i);
    expect(() => parseMajor('', 'USD')).toThrow(/amount/i);
    expect(() => parseMajor('abc', 'USD')).toThrow(/amount/i);
    expect(() => parseMajor('1e3', 'USD')).toThrow(/amount/i);
  });
});

describe('SUPPORTED_CURRENCIES', () => {
  it('lists exactly the currencies the math can scale', () => {
    // the family-creation picker reads this list; a currency it offers but
    // minorDigits cannot scale would break every amount in that family
    expect(SUPPORTED_CURRENCIES.length).toBeGreaterThan(0);
    for (const code of SUPPORTED_CURRENCIES) {
      expect(() => minorDigits(code)).not.toThrow();
    }
  });
});
