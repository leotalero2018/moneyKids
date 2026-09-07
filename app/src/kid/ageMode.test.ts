import { describe, it, expect } from 'vitest';
import { ageModeFor } from './ageMode.js';

const today = new Date('2026-09-07T00:00:00Z');

describe('ageModeFor', () => {
  it('maps age bands from the birth year', () => {
    expect(ageModeFor(2020, null, today)).toBe('5-8');   // 6
    expect(ageModeFor(2016, null, today)).toBe('8-12');  // 10
    expect(ageModeFor(2011, null, today)).toBe('12-16'); // 15
  });
  it('puts the boundaries where the spec puts them', () => {
    // the bands in the spec overlap at 8 and 12; the older mode wins, because
    // a kid who has outgrown the simpler screens should not be pushed back
    expect(ageModeFor(2018, null, today)).toBe('8-12');  // exactly 8
    expect(ageModeFor(2014, null, today)).toBe('12-16'); // exactly 12
  });
  it('clamps ages outside the range instead of throwing', () => {
    expect(ageModeFor(2024, null, today)).toBe('5-8');   // 2
    expect(ageModeFor(2001, null, today)).toBe('12-16'); // 25
  });
  it('lets a per-kid override win', () => {
    expect(ageModeFor(2020, '12-16', today)).toBe('12-16');
    expect(ageModeFor(2011, '5-8', today)).toBe('5-8');
  });
  it('ignores an override that is not a real mode', () => {
    // it arrives from a Firestore document, so it is untrusted: returning it
    // verbatim would stamp a data-age-mode no CSS block matches
    expect(ageModeFor(2016, 'grown-up' as never, today)).toBe('8-12');
    expect(ageModeFor(2016, '' as never, today)).toBe('8-12');
  });
});
