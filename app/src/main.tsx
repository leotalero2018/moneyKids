import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { initI18n } from './i18n/index.js';
import { kidBundle } from './firebase.js';
import './styles/global.css';

// initialize inside a .then rather than with a top-level await: top-level
// await is not available in the browser targets vite builds for, and the
// production build fails on it even though tests (which never build) pass
if (import.meta.env.DEV) {
  // Test seam, dev builds only. The e2e cache-isolation spec has to ask a
  // question no UI assertion can answer — is the previous kid's document
  // still readable from this device? — and Playwright cannot import the
  // Firestore SDK into the page, because Vite serves bare specifiers only
  // through transformed modules. import.meta.env.DEV is statically false in
  // `vite build`, so this whole block is dropped from production.
  void import('firebase/firestore').then(({ doc, getDocFromCache, getDocFromServer }) => {
    (window as unknown as { __mk: unknown }).__mk = {
      cachedRead: async (path: string) => {
        try {
          return (await getDocFromCache(doc(kidBundle().db, path))).exists();
        } catch {
          return false; // not in the cache at all
        }
      },
      serverRead: async (path: string) => {
        try {
          await getDocFromServer(doc(kidBundle().db, path));
          return 'allowed';
        } catch (e) {
          return (e as { code?: string }).code ?? 'error';
        }
      },
    };
  });
}

void initI18n('es').then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
