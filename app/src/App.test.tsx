import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { initI18n } from './i18n/index.js';
import { App } from './App.js';

describe('app shell', () => {
  beforeAll(async () => { await initI18n('es'); });
  it('renders translated copy, not raw keys', () => {
    render(<App />);
    expect(screen.getByRole('main')).toHaveTextContent('Facturas');
  });
});
