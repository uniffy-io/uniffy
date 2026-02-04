/**
 * Default event templates for quick event creation
 */

import { DEFAULT_DURATIONS } from '@/features/calendar/constants/timeRanges';

/**
 * Event template definition
 */
export interface EventTemplate {
  id: string;
  name: string;
  icon: string;
  duration: number; // in minutes
  categoryId: string;
  description?: string;
  defaultTitle?: string;
  isFocusTime?: boolean;
  isDefault: boolean;
}

/**
 * Default event templates
 */
export const DEFAULT_TEMPLATES: EventTemplate[] = [
  {
    id: 'weekly_sync',
    name: 'Weekly Sync',
    icon: '📋',
    duration: 45,
    categoryId: 'meetings',
    defaultTitle: 'Weekly Sync',
    description: 'Regular team sync meeting',
    isDefault: true,
  },
  {
    id: 'one_on_one',
    name: '1-on-1 Meeting',
    icon: '📋',
    duration: 30,
    categoryId: 'meetings',
    defaultTitle: '1:1',
    description: 'One-on-one meeting',
    isDefault: true,
  },
  {
    id: 'focus_block',
    name: 'Focus Block',
    icon: '📋',
    duration: DEFAULT_DURATIONS.FOCUS,
    categoryId: 'deep_work',
    defaultTitle: 'Focus Time',
    description: 'Dedicated deep work time',
    isFocusTime: true,
    isDefault: true,
  },
  {
    id: 'standup',
    name: 'Daily Standup',
    icon: '📋',
    duration: 15,
    categoryId: 'meetings',
    defaultTitle: 'Daily Standup',
    description: 'Quick daily sync',
    isDefault: true,
  },
  {
    id: 'planning',
    name: 'Planning Session',
    icon: '📋',
    duration: 90,
    categoryId: 'meetings',
    defaultTitle: 'Planning',
    description: 'Sprint or project planning',
    isDefault: true,
  },
];

/**
 * Get template by ID
 */
export function getTemplateById(templateId: string): EventTemplate | undefined {
  return DEFAULT_TEMPLATES.find((t) => t.id === templateId);
}

/**
 * Template quick action buttons
 */
export const TEMPLATE_QUICK_ACTIONS = [
  { id: 'weekly_sync', label: 'Sync', shortcut: '1' },
  { id: 'one_on_one', label: '1:1', shortcut: '2' },
  { id: 'focus_block', label: 'Focus', shortcut: '3' },
] as const;
