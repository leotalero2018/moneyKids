import { describe, it, expect } from 'vitest';
import { MINOR_UNIT_NOTE } from './index.js';

describe('workspace sanity', () => {
  it('imports the shared package', () => {
    expect(MINOR_UNIT_NOTE).toContain('minor units');
  });
});
