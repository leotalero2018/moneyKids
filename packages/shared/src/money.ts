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
