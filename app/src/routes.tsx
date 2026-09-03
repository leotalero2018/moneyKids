import type { ReactElement } from 'react';
import { Kids } from './screens/Kids.js';
import { Settings } from './screens/Settings.js';
import { Activities } from './screens/Activities.js';
import { Inbox } from './screens/Inbox.js';
import { InvoiceDetail } from './screens/InvoiceDetail.js';
import { JoinParent } from './screens/JoinParent.js';

export interface RouteDef { path: string; element: ReactElement }

export const PARENT_TABS: { to: string; labelKey: string }[] = [
  { to: '/inbox', labelKey: 'nav.inbox' },
  { to: '/activities', labelKey: 'nav.activities' },
  { to: '/kids', labelKey: 'nav.kids' },
  { to: '/settings', labelKey: 'nav.settings' },
];

export const parentRoutes: RouteDef[] = [
  { path: '/inbox', element: <Inbox /> },
  { path: '/invoice/:invoiceId', element: <InvoiceDetail /> },
  { path: '/activities', element: <Activities /> },
  { path: '/kids', element: <Kids /> },
  { path: '/settings', element: <Settings /> },
  { path: '/join', element: <JoinParent /> },
];
