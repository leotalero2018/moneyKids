import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { initI18n } from './i18n/index.js';
import './styles/global.css';

// initialize inside a .then rather than with a top-level await: top-level
// await is not available in the browser targets vite builds for, and the
// production build fails on it even though tests (which never build) pass
void initI18n('es').then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
