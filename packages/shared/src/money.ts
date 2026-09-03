export type Destination = 'savings' | 'withheld';

export interface DeductionRule {
  nameEs: string;
  nameEn: string;
  basisPoints: number;
  destination: Destination;
}

export interface DeductionLine extends DeductionRule {
  amount: number;
}

export interface DeductionBreakdown {
  gross: number;
  lines: DeductionLine[];
  netAmount: number;
  savingsTotal: number;
  withheldTotal: number;
}

const MAX_RULES = 20;
const MAX_NAME_LENGTH = 60;

export function validateDeductionRules(rules: unknown): asserts rules is DeductionRule[] {
  if (!Array.isArray(rules)) throw new Error('deduction rules must be an array');
  if (rules.length > MAX_RULES) throw new Error(`too many deduction rules (max ${MAX_RULES})`);
  let sum = 0;
  for (const r of rules) {
    if (typeof r !== 'object' || r === null) throw new Error('each rule must be an object');
    const { nameEs, nameEn, basisPoints, destination } = r as Record<string, unknown>;
    for (const name of [nameEs, nameEn]) {
      if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LENGTH) {
        throw new Error(`rule names must be 1-${MAX_NAME_LENGTH} character strings`);
      }
    }
    if (destination !== 'savings' && destination !== 'withheld') {
      throw new Error("destination must be 'savings' or 'withheld'");
    }
    if (typeof basisPoints !== 'number' || !Number.isInteger(basisPoints) || basisPoints < 0) {
      throw new Error('basisPoints must be a non-negative integer');
    }
    sum += basisPoints;
  }
  if (sum > 10000) throw new Error('deduction rules exceed 100%');
}

export function computeDeductions(gross: number, rules: DeductionRule[]): DeductionBreakdown {
  if (!Number.isInteger(gross) || gross <= 0) throw new Error('gross must be a positive integer');
  validateDeductionRules(rules);
  const raw = rules.map((r) => (gross * r.basisPoints) / 10000);
  const amounts = raw.map(Math.floor);
  const totalBp = rules.reduce((s, r) => s + r.basisPoints, 0);
  let remainder = Math.floor((gross * totalBp) / 10000) - amounts.reduce((s, a) => s + a, 0);
  const byFraction = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byFraction) {
    if (remainder <= 0) break;
    amounts[i]! += 1;
    remainder -= 1;
  }
  const lines: DeductionLine[] = rules.map((r, i) => ({ ...r, amount: amounts[i]! }));
  const savingsTotal = lines.filter((l) => l.destination === 'savings').reduce((s, l) => s + l.amount, 0);
  const withheldTotal = lines.filter((l) => l.destination === 'withheld').reduce((s, l) => s + l.amount, 0);
  return { gross, lines, netAmount: gross - savingsTotal - withheldTotal, savingsTotal, withheldTotal };
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function minorDigits(currency: string): number {
  if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
    throw new Error('currency must be a three-letter uppercase ISO 4217 code');
  }
  let digits: number | undefined;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency })
      .resolvedOptions().maximumFractionDigits;
  } catch {
    throw new Error(`currency ${currency} is not a known ISO 4217 code`);
  }
  if (digits === undefined) throw new Error(`currency ${currency} has no known minor unit`);
  return digits;
}

export function formatMinor(minor: number, currency: string, locale: string): string {
  if (!Number.isInteger(minor)) throw new Error('amount must be an integer in minor units');
  const digits = minorDigits(currency);
  const major = minor / 10 ** digits;
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency,
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(major);
}

/**
 * User-typed major units -> integer minor units.
 *
 * Zero-decimal currency: every separator is grouping and is stripped, except a
 * trailing [.,]\d{1,2}, which is someone typing cents that do not exist and
 * must fail loudly rather than silently become a 100x error.
 *
 * Two-decimal currency: exactly one separator with 1-2 fraction digits, no
 * grouping. '1,234' throws — guessing between 1234 and 1.234 is a 1000x money
 * error, so callers strip grouping before calling.
 */
export function parseMajor(input: string, currency: string): number {
  const digits = minorDigits(currency);
  if (typeof input !== 'string') throw new Error('amount must be text');
  const trimmed = input.replace(/\s/g, '');
  if (trimmed === '') throw new Error('amount is required');

  if (digits === 0) {
    if (/[.,]\d{1,2}$/.test(trimmed)) {
      throw new Error(`${currency} has no decimal places`);
    }
    const whole = trimmed.replace(/[.,]/g, '');
    if (!/^\d+$/.test(whole)) throw new Error('amount must be a non-negative number');
    return Number(whole);
  }

  const match = /^(\d+)(?:[.,](\d+))?$/.exec(trimmed);
  if (!match) throw new Error('amount must be a non-negative number');
  const whole = match[1]!;
  const frac = match[2] ?? '';
  if (frac.length > digits) {
    throw new Error(`amount has more decimal places than ${currency} allows`);
  }
  return Number(whole) * 10 ** digits + Number(frac.padEnd(digits, '0') || 0);
}
