// Callable payloads are untrusted. These IDs are interpolated into Firestore
// document paths, so a value containing '/' would re-point the path at a
// different document; requestId also becomes part of a ledger document ID.
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_ID_LENGTH = 128;
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 8;

export function validateId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH
      || !ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a 1-${MAX_ID_LENGTH} character id of [A-Za-z0-9_-]`);
  }
  return value;
}

export function validateRequestId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 64
      || !ID_PATTERN.test(value)) {
    throw new Error('requestId must be an opaque 8-64 character key of [A-Za-z0-9_-]');
  }
  return value;
}

export function validateNote(value: unknown, max = 500): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`note must be a string of at most ${max} characters`);
  }
  return value;
}

export function validateJoinCode(value: unknown): string {
  if (typeof value !== 'string' || value.length !== JOIN_CODE_LENGTH
      || ![...value].every((c) => JOIN_CODE_ALPHABET.includes(c))) {
    throw new Error(`join code must be ${JOIN_CODE_LENGTH} characters from the code alphabet`);
  }
  return value;
}

export function validateBalance(value: unknown): 'spendable' | 'savings' {
  if (value !== 'spendable' && value !== 'savings') {
    throw new Error("balance must be 'spendable' or 'savings'");
  }
  return value;
}
