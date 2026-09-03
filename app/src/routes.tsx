import type { ReactElement } from 'react';

export interface RouteDef { path: string; element: ReactElement }

export const PARENT_TABS: { to: string; labelKey: string }[] = [
  { to: '/inbox', labelKey: 'nav.inbox' },
];

export const parentRoutes: RouteDef[] = [];
