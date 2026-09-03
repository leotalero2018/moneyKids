import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './session/SessionContext.js';
import { SignIn } from './screens/SignIn.js';
import { CreateFamily } from './screens/CreateFamily.js';
import { BottomTabs } from './components/BottomTabs.js';
import { Spinner } from './components/Spinner.js';
import { PARENT_TABS, parentRoutes } from './routes.js';

/**
 * The signed-in shell is its OWN component, not a branch inside Shell.
 * Task 11 adds a hook here for the inbox badge, and a hook must never sit
 * after an early return — so the status guards live in Shell and every
 * parent-only hook lives here, where it runs on every render.
 */
function ParentShell() {
  return (
    <>
      <main>
        <Routes>
          {parentRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
          <Route path="*" element={<Navigate to={PARENT_TABS[0]!.to} replace />} />
        </Routes>
      </main>
      <BottomTabs tabs={PARENT_TABS.map((tab) => ({ ...tab }))} />
    </>
  );
}

function Shell() {
  const { status } = useSession();
  if (status === 'loading') return <main><Spinner /></main>;
  if (status === 'signed-out') return <SignIn />;
  if (status === 'no-family') return <CreateFamily />;
  return <ParentShell />;
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </BrowserRouter>
  );
}
