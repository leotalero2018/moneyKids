import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL only auto-cleans when vitest runs with globals: true. Without this,
// every render stacks up in the same document and queries find duplicates.
afterEach(() => { cleanup(); });
