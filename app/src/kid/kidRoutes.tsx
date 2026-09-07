import type { ReactElement } from 'react';

export interface RouteDef { path: string; element: ReactElement }

// Tasks 4, 5, 8 and 9 append here. Paths are RELATIVE: KidShell renders
// inside the parent route `/kid/*`, so '' is the kid home and 'new' is
// /kid/new. Tab `to` values stay absolute, because NavLink needs a real URL.
export const KID_TABS: { to: string; labelKey: string }[] = [];

export const kidRoutes: RouteDef[] = [];
