import type { ReactElement } from 'react';
import { Kids } from './screens/Kids.js';
import { Settings } from './screens/Settings.js';
import { JoinParent } from './screens/JoinParent.js';

export interface RouteDef { path: string; element: ReactElement }

export const PARENT_TABS: { to: string; labelKey: string }[] = [
  { to: '/inbox', labelKey: 'nav.inbox' },
  { to: '/kids', labelKey: 'nav.kids' },
  { to: '/settings', labelKey: 'nav.settings' },
];

export const parentRoutes: RouteDef[] = [
  { path: '/kids', element: <Kids /> },
  { path: '/settings', element: <Settings /> },
  { path: '/join', element: <JoinParent /> },
];
