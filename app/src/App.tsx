import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './session/SessionContext.js';
import { SignIn } from './screens/SignIn.js';
import { CreateFamily } from './screens/CreateFamily.js';
import { JoinParent } from './screens/JoinParent.js';
import { BottomTabs } from './components/BottomTabs.js';
import { PinGate } from './components/PinGate.js';
import { Spinner } from './components/Spinner.js';
import { PARENT_TABS, parentRoutes } from './routes.js';
import { usePendingCount } from './screens/Inbox.js';
import { KidSessionProvider } from './kid/KidSessionContext.js';
import { KidShell } from './kid/KidShell.js';

/**
 * The signed-in shell is its OWN component, not a branch inside Shell.
 * Task 11 adds a hook here for the inbox badge, and a hook must never sit
 * after an early return — so the status guards live in Shell and every
 * parent-only hook lives here, where it runs on every render.
 */
function ParentShell() {
  // safe here: ParentShell only ever renders when status === 'ready', so this
  // hook runs on every one of its renders
  const pending = usePendingCount();
  return (
    <PinGate>
      <main>
        <Routes>
          {parentRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
          <Route path="*" element={<Navigate to={PARENT_TABS[0]!.to} replace />} />
        </Routes>
      </main>
      <BottomTabs
        tabs={PARENT_TABS.map((tab) => (
          tab.to === '/inbox' ? { ...tab, badge: pending } : { ...tab }
        ))}
      />
    </PinGate>
  );
}

function Shell() {
  const { status } = useSession();
  if (status === 'loading') return <main><Spinner /></main>;
  if (status === 'signed-out') return <SignIn />;
  if (status === 'no-family') {
    // an invited parent needs /join before they have any family
    return (
      <Routes>
        <Route path="join" element={<JoinParent />} />
        <Route path="*" element={<CreateFamily />} />
      </Routes>
    );
  }
  return <ParentShell />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* the kid app has its own session and its own Firebase instance, and
            a kid device has no parent session at all — so it sits OUTSIDE the
            parent session gate */}
        <Route
          path="/kid/*"
          element={<KidSessionProvider><KidShell /></KidSessionProvider>}
        />
        <Route path="*" element={<SessionProvider><Shell /></SessionProvider>} />
      </Routes>
    </BrowserRouter>
  );
}
