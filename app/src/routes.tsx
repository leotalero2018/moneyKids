import type { ReactElement } from 'react';
import { Kids } from './screens/Kids.js';

export interface RouteDef { path: string; element: ReactElement }

export const PARENT_TABS: { to: string; labelKey: string }[] = [
  { to: '/inbox', labelKey: 'nav.inbox' },
  { to: '/kids', labelKey: 'nav.kids' },
];

export const parentRoutes: RouteDef[] = [
  { path: '/kids', element: <Kids /> },
];
