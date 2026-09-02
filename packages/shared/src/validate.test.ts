import { describe, it, expect } from 'vitest';
import {
  validateId, validateRequestId, validateNote, validateJoinCode, validateBalance,
} from './validate.js';

describe('validateId', () => {
  it('accepts normal Firestore auto-IDs', () => {
    expect(validateId('kK9xZ2aBcDeF', 'invoiceId')).toBe('kK9xZ2aBcDeF');
    expect(validateId('fam1', 'familyId')).toBe('fam1');
  });
  it('rejects path traversal and separators — these are interpolated into doc paths', () => {
    expect(() => validateId('fam1/../fam2', 'familyId')).toThrow(/familyId/);
    expect(() => validateId('fam1/members/p1', 'familyId')).toThrow(/familyId/);
    expect(() => validateId('..', 'kidId')).toThrow(/kidId/);
    expect(() => validateId('.', 'kidId')).toThrow(/kidId/);
  });
  it('rejects empty, oversized, and non-string values', () => {
    expect(() => validateId('', 'kidId')).toThrow(/kidId/);
    expect(() => validateId('x'.repeat(129), 'kidId')).toThrow(/kidId/);
    expect(() => validateId(undefined, 'kidId')).toThrow(/kidId/);
    expect(() => validateId(42, 'kidId')).toThrow(/kidId/);
    expect(() => validateId({ toString: () => 'ok' }, 'kidId')).toThrow(/kidId/);
  });
});

describe('validateRequestId', () => {
  it('accepts a UUID and other opaque keys', () => {
    expect(validateRequestId('9f1c2b7e-3a44-4c9d-8f21-6b0d5e7a1c33')).toHaveLength(36);
    expect(validateRequestId('abc12345')).toBe('abc12345');
  });
  it('rejects too-short, too-long, and separator-bearing keys', () => {
    expect(() => validateRequestId('short')).toThrow(/requestId/);
    expect(() => validateRequestId('x'.repeat(65))).toThrow(/requestId/);
    expect(() => validateRequestId('r1/../credit_inv1')).toThrow(/requestId/);
  });
});

describe('validateNote', () => {
  it('accepts empty and bounded text', () => {
    expect(validateNote('')).toBe('');
    expect(validateNote('efectivo')).toBe('efectivo');
  });
  it('rejects overlong text and non-strings', () => {
    expect(() => validateNote('x'.repeat(501))).toThrow(/note/);
    expect(() => validateNote(null)).toThrow(/note/);
  });
});

describe('validateJoinCode', () => {
  it('accepts a well-formed code', () => {
    expect(validateJoinCode('ABCD2345')).toBe('ABCD2345');
  });
  it('rejects wrong length, lowercase, and excluded lookalike characters', () => {
    expect(() => validateJoinCode('ABC123')).toThrow(/code/i);
    expect(() => validateJoinCode('abcd2345')).toThrow(/code/i);
    expect(() => validateJoinCode('ABCD2340')).toThrow(/code/i); // 0 excluded
    expect(() => validateJoinCode('ABCD234I')).toThrow(/code/i); // I excluded
  });
});

describe('validateBalance', () => {
  it('accepts the two balances and rejects anything else', () => {
    expect(validateBalance('spendable')).toBe('spendable');
    expect(validateBalance('savings')).toBe('savings');
    expect(() => validateBalance('pocket')).toThrow(/balance/);
    expect(() => validateBalance(undefined)).toThrow(/balance/);
  });
});
