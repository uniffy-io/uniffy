/**
 * Content Type Configuration
 *
 * Centralized configuration for all content types in UNIFFY.
 * Provides icons, labels, routes, and theme info for consistent
 * rendering across navigation, search, mentions, and other components.
 *
 * This is the SINGLE SOURCE OF TRUTH for content type display properties.
 */

import type { Icon } from '@phosphor-icons/react';
import {
  NotePencil,
  FolderSimple,
  ChatTeardrop,
  User,
  CalendarDots,
  Kanban,
  CheckSquare,
  Brain,
  Notebook,
  Question,
} from '@phosphor-icons/react';
import { UrnType } from '@/shared/utils/urnTypes';
import { getUrnTypeTheme, getUrnTypeHexColor, type UrnTypeTheme } from '@/config/theme/urnColors';

/**
 * Configuration for a content type
 */
export interface ContentTypeConfig {
  /** The URN type identifier */
  type: UrnType;
  /** Phosphor icon component */
  icon: Icon;
  /** Singular label (e.g., "Note") */
  label: string;
  /** Plural label (e.g., "Notes") */
  labelPlural: string;
  /** URL route segment (e.g., "notes") */
  route: string;
  /** Theme colors and classes */
  theme: UrnTypeTheme;
  /** Hex color for canvas/SVG rendering */
  hexColor: string;
}

/**
 * Content type configurations indexed by UrnType
 */
export const CONTENT_TYPE_CONFIG: Record<UrnType, ContentTypeConfig> = {
  [UrnType.NOTE]: {
    type: UrnType.NOTE,
    icon: NotePencil,
    label: 'Note',
    labelPlural: 'Notes',
    route: 'notes',
    theme: getUrnTypeTheme(UrnType.NOTE),
    hexColor: getUrnTypeHexColor(UrnType.NOTE),
  },
  [UrnType.FILE]: {
    type: UrnType.FILE,
    icon: FolderSimple,
    label: 'File',
    labelPlural: 'Files',
    route: 'files',
    theme: getUrnTypeTheme(UrnType.FILE),
    hexColor: getUrnTypeHexColor(UrnType.FILE),
  },
  [UrnType.CHAT]: {
    type: UrnType.CHAT,
    icon: ChatTeardrop,
    label: 'Chat',
    labelPlural: 'Chats',
    route: 'chats',
    theme: getUrnTypeTheme(UrnType.CHAT),
    hexColor: getUrnTypeHexColor(UrnType.CHAT),
  },
  [UrnType.USER]: {
    type: UrnType.USER,
    icon: User,
    label: 'User',
    labelPlural: 'Users',
    route: 'users',
    theme: getUrnTypeTheme(UrnType.USER),
    hexColor: getUrnTypeHexColor(UrnType.USER),
  },
  [UrnType.CALENDAR_EVENT]: {
    type: UrnType.CALENDAR_EVENT,
    icon: CalendarDots,
    label: 'Event',
    labelPlural: 'Events',
    route: 'calendar',
    theme: getUrnTypeTheme(UrnType.CALENDAR_EVENT),
    hexColor: getUrnTypeHexColor(UrnType.CALENDAR_EVENT),
  },
  [UrnType.PROJECT]: {
    type: UrnType.PROJECT,
    icon: Kanban,
    label: 'Project',
    labelPlural: 'Projects',
    route: 'projects',
    theme: getUrnTypeTheme(UrnType.PROJECT),
    hexColor: getUrnTypeHexColor(UrnType.PROJECT),
  },
  [UrnType.TASK]: {
    type: UrnType.TASK,
    icon: CheckSquare,
    label: 'Task',
    labelPlural: 'Tasks',
    route: 'projects', // Tasks are accessed within projects
    theme: getUrnTypeTheme(UrnType.TASK),
    hexColor: getUrnTypeHexColor(UrnType.TASK),
  },
  [UrnType.AGENT]: {
    type: UrnType.AGENT,
    icon: Brain,
    label: 'Agent',
    labelPlural: 'Agents',
    route: 'agents',
    theme: getUrnTypeTheme(UrnType.AGENT),
    hexColor: getUrnTypeHexColor(UrnType.AGENT),
  },
  [UrnType.PROMPT]: {
    type: UrnType.PROMPT,
    icon: Notebook,
    label: 'Prompt',
    labelPlural: 'Prompts',
    route: 'agents/prompts',
    theme: getUrnTypeTheme(UrnType.PROMPT),
    hexColor: getUrnTypeHexColor(UrnType.PROMPT),
  },
  [UrnType.UNKNOWN]: {
    type: UrnType.UNKNOWN,
    icon: Question,
    label: 'Unknown',
    labelPlural: 'Items',
    route: '',
    theme: getUrnTypeTheme(UrnType.UNKNOWN),
    hexColor: getUrnTypeHexColor(UrnType.UNKNOWN),
  },
};

/**
 * Get content type configuration by URN type
 */
export function getContentTypeConfig(type: UrnType): ContentTypeConfig {
  return CONTENT_TYPE_CONFIG[type] || CONTENT_TYPE_CONFIG[UrnType.UNKNOWN];
}

/**
 * Get content type icon component by URN type
 */
export function getContentTypeIcon(type: UrnType): Icon {
  return getContentTypeConfig(type).icon;
}

/**
 * Get content type label by URN type
 */
export function getContentTypeLabel(type: UrnType): string {
  return getContentTypeConfig(type).label;
}

/**
 * Get content type plural label by URN type
 */
export function getContentTypeLabelPlural(type: UrnType): string {
  return getContentTypeConfig(type).labelPlural;
}

/**
 * Get content type route by URN type
 */
export function getContentTypeRoute(type: UrnType): string {
  return getContentTypeConfig(type).route;
}

/**
 * List of all navigable content types (excludes UNKNOWN)
 * Useful for building navigation menus and filters
 */
export const NAVIGABLE_CONTENT_TYPES: ContentTypeConfig[] = Object.values(CONTENT_TYPE_CONFIG)
  .filter((config) => config.type !== UrnType.UNKNOWN);
