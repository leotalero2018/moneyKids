import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useKidSession } from './KidSessionContext.js';
import { JoinKid } from '../screens/kid/JoinKid.js';
import { BottomTabs } from '../components/BottomTabs.js';
import { ProfileSwitcher } from '../components/ProfileSwitcher.js';
import { Spinner } from '../components/Spinner.js';
import { KID_TABS, kidRoutes } from './kidRoutes.js';

export function KidShell() {
  const { status, ageMode } = useKidSession();

  useEffect(() => {
    // on the ROOT element, so every token override applies to portals and
    // fixed-position chrome too, not just the subtree
    document.documentElement.dataset.ageMode = ageMode;
    return () => { delete document.documentElement.dataset.ageMode; };
  }, [ageMode]);

  if (status === 'loading') return <main><Spinner /></main>;
  if (status === 'signed-out') return <JoinKid />;

  return (
    <>
      <main>
        <Routes>
          {kidRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
          {KID_TABS.length > 0 && (
            <Route path="*" element={<Navigate to={KID_TABS[0]!.to} replace />} />
          )}
        </Routes>
        {/* on a shared phone this hands the device back; on a kid-only
            device it simply lands on the parent sign-in, which is harmless */}
        <ProfileSwitcher direction="to-parent" />
      </main>
      {KID_TABS.length > 0 && <BottomTabs tabs={KID_TABS.map((tab) => ({ ...tab }))} />}
    </>
  );
}
