import type { ReactElement } from 'react';

// Paths are RELATIVE: the parent shell renders inside App's `path="*"`
// route, and an absolute child path does not match under a splat — every tab
// but the first would bounce off the catch-all in a redirect loop. Tab `to`
// values stay absolute, because NavLink needs a real URL.
import { Kids } from './screens/Kids.js';
import { Settings } from './screens/Settings.js';
import { Activities } from './screens/Activities.js';
import { Inbox } from './screens/Inbox.js';
import { InvoiceDetail } from './screens/InvoiceDetail.js';
import { Payouts } from './screens/Payouts.js';
import { JoinParent } from './screens/JoinParent.js';

export interface RouteDef { path: string; element: ReactElement }

export const PARENT_TABS: { to: string; labelKey: string }[] = [
  { to: '/inbox', labelKey: 'nav.inbox' },
  { to: '/activities', labelKey: 'nav.activities' },
  { to: '/kids', labelKey: 'nav.kids' },
  { to: '/payouts', labelKey: 'nav.payouts' },
  { to: '/settings', labelKey: 'nav.settings' },
];

export const parentRoutes: RouteDef[] = [
  { path: 'inbox', element: <Inbox /> },
  { path: 'invoice/:invoiceId', element: <InvoiceDetail /> },
  { path: 'activities', element: <Activities /> },
  { path: 'kids', element: <Kids /> },
  { path: 'payouts', element: <Payouts /> },
  { path: 'settings', element: <Settings /> },
  { path: 'join', element: <JoinParent /> },
];
