/** Extracted from EventScopeFilter to avoid react-refresh warnings on mixed exports. */

import { CalendarBlank, LockSimple, Buildings } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

export type EventScope = 'all' | 'personal' | 'organization';

export interface ScopeFilterConfig {
  id: EventScope;
  name: string;
  icon: Icon;
}

export const SCOPE_FILTERS: ScopeFilterConfig[] = [
  { id: 'all', name: 'All', icon: CalendarBlank },
  { id: 'personal', name: 'Personal', icon: LockSimple },
  { id: 'organization', name: 'Org', icon: Buildings },
];
