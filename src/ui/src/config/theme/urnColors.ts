/**
 * URN Type Colors
 *
 * Centralized color definitions for URN entity types.
 * Used across the app for consistent styling of notes, files, users, etc.
 *
 * Provides both:
 * - Hex colors for canvas/SVG rendering
 * - Tailwind classes for component styling
 */

import { UrnType } from '@/shared/utils/urnTypes';

/**
 * Hex color values for each URN type.
 * Used for canvas rendering (graphs, charts, etc.)
 */
export const URN_TYPE_HEX_COLORS: Record<UrnType, string> = {
  [UrnType.NOTE]: '#8b5cf6',           // violet-500 (fallback, usually uses primary)
  [UrnType.FILE]: '#3b82f6',           // blue-500
  [UrnType.CHAT]: '#8b5cf6',           // violet-500
  [UrnType.USER]: '#10b981',           // emerald-500
  [UrnType.CALENDAR_EVENT]: '#f43f5e', // rose-500
  [UrnType.PROJECT]: '#f97316',        // orange-500
  [UrnType.TASK]: '#14b8a6',           // teal-500
  [UrnType.AGENT]: '#06b6d4',          // cyan-500
  [UrnType.PROMPT]: '#a855f7',         // purple-500
  [UrnType.UNKNOWN]: '#6b7280',        // gray-500
};

/**
 * Tailwind theme configuration for each URN type.
 * Used for component styling with proper light/dark mode support.
 */
export interface UrnTypeTheme {
  /** Gradient background for selected/highlighted states */
  gradient: string;
  /** Background gradient for icon badges */
  iconBg: string;
  /** Accent text color with dark mode variant */
  accentText: string;
  /** Background for subtle badges/pills */
  badgeBg: string;
  /** Border color */
  border: string;
  /** Shadow color for glow effects */
  shadow: string;
}

export const URN_TYPE_THEMES: Record<UrnType, UrnTypeTheme> = {
  [UrnType.NOTE]: {
    gradient: 'from-primary/10 via-primary/5 to-transparent',
    iconBg: 'bg-gradient-to-br from-primary to-primary/80',
    accentText: 'text-primary',
    badgeBg: 'bg-primary/10',
    border: 'border-primary/20',
    shadow: 'shadow-primary/50',
  },
  [UrnType.FILE]: {
    gradient: 'from-blue-500/10 via-blue-500/5 to-transparent',
    iconBg: 'bg-gradient-to-br from-blue-500 to-blue-600',
    accentText: 'text-blue-600 dark:text-blue-400',
    badgeBg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    shadow: 'shadow-blue-500/50',
  },
  [UrnType.CHAT]: {
    gradient: 'from-violet-500/10 via-violet-500/5 to-transparent',
    iconBg: 'bg-gradient-to-br from-violet-500 to-violet-600',
    accentText: 'text-violet-600 dark:text-violet-400',
    badgeBg: 'bg-violet-500/10',
    border: 'border-violet-500/20',
    shadow: 'shadow-violet-500/50',
  },
  [UrnType.USER]: {
    gradient: 'from-emerald-500/10 via-emerald-500/5 to-transparent',
    iconBg: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
    accentText: 'text-emerald-600 dark:text-emerald-400',
    badgeBg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    shadow: 'shadow-emerald-500/50',
  },
  [UrnType.CALENDAR_EVENT]: {
    gradient: 'from-rose-500/10 via-rose-500/5 to-transparent',
    iconBg: 'bg-gradient-to-br from-rose-500 to-rose-600',
    accentText: 'text-rose-600 dark:text-rose-400',
    badgeBg: 'bg-rose-500/10',
    border: 'border-rose-500/20',
    shadow: 'shadow-rose-500/50',
  },
  [UrnType.PROJECT]: {
    gradient: 'from-orange-500/10 via-orange-500/5 to-transparent',
    iconBg: 'bg-gradient-to-br from-orange-500 to-orange-600',
    accentText: 'text-orange-600 dark:text-orange-400',
    badgeBg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
    shadow: 'shadow-orange-500/50',
  },
  [UrnType.TASK]: {
    gradient: 'from-teal-500/10 via-teal-500/5 to-transparent',
    iconBg: 'bg-gradient-to-br from-teal-500 to-teal-600',
    accentText: 'text-teal-600 dark:text-teal-400',
    badgeBg: 'bg-teal-500/10',
    border: 'border-teal-500/20',
    shadow: 'shadow-teal-500/50',
  },
  [UrnType.AGENT]: {
    gradient: 'from-cyan-500/10 via-cyan-500/5 to-transparent',
    iconBg: 'bg-gradient-to-br from-cyan-500 to-cyan-600',
    accentText: 'text-cyan-600 dark:text-cyan-400',
    badgeBg: 'bg-cyan-500/10',
    border: 'border-cyan-500/20',
    shadow: 'shadow-cyan-500/50',
  },
  [UrnType.PROMPT]: {
    gradient: 'from-purple-500/10 via-purple-500/5 to-transparent',
    iconBg: 'bg-gradient-to-br from-purple-500 to-purple-600',
    accentText: 'text-purple-600 dark:text-purple-400',
    badgeBg: 'bg-purple-500/10',
    border: 'border-purple-500/20',
    shadow: 'shadow-purple-500/50',
  },
  [UrnType.UNKNOWN]: {
    gradient: 'from-gray-500/10 via-gray-500/5 to-transparent',
    iconBg: 'bg-gradient-to-br from-gray-400 to-gray-500',
    accentText: 'text-muted-foreground',
    badgeBg: 'bg-gray-500/10',
    border: 'border-gray-500/20',
    shadow: 'shadow-gray-500/50',
  },
};

/**
 * Get hex color for a URN type.
 * For canvas/SVG rendering where Tailwind classes can't be used.
 */
export function getUrnTypeHexColor(type: UrnType): string {
  return URN_TYPE_HEX_COLORS[type] || URN_TYPE_HEX_COLORS[UrnType.UNKNOWN];
}

/**
 * Get Tailwind theme classes for a URN type.
 * For component styling with proper light/dark mode support.
 */
export function getUrnTypeTheme(type: UrnType): UrnTypeTheme {
  return URN_TYPE_THEMES[type] || URN_TYPE_THEMES[UrnType.UNKNOWN];
}

/**
 * Legend items for displaying URN type colors.
 * Useful for graph legends, filter lists, etc.
 */
export const URN_TYPE_LEGEND: Array<{
  type: UrnType;
  label: string;
  hexColor: string;
  tailwindBg: string;
}> = [
  { type: UrnType.NOTE, label: 'Notes', hexColor: URN_TYPE_HEX_COLORS[UrnType.NOTE], tailwindBg: 'bg-primary' },
  { type: UrnType.USER, label: 'Users', hexColor: URN_TYPE_HEX_COLORS[UrnType.USER], tailwindBg: 'bg-emerald-500' },
  { type: UrnType.FILE, label: 'Files', hexColor: URN_TYPE_HEX_COLORS[UrnType.FILE], tailwindBg: 'bg-blue-500' },
  { type: UrnType.CHAT, label: 'Chats', hexColor: URN_TYPE_HEX_COLORS[UrnType.CHAT], tailwindBg: 'bg-violet-500' },
  { type: UrnType.CALENDAR_EVENT, label: 'Events', hexColor: URN_TYPE_HEX_COLORS[UrnType.CALENDAR_EVENT], tailwindBg: 'bg-rose-500' },
  { type: UrnType.PROJECT, label: 'Projects', hexColor: URN_TYPE_HEX_COLORS[UrnType.PROJECT], tailwindBg: 'bg-orange-500' },
  { type: UrnType.TASK, label: 'Tasks', hexColor: URN_TYPE_HEX_COLORS[UrnType.TASK], tailwindBg: 'bg-teal-500' },
  { type: UrnType.AGENT, label: 'Agents', hexColor: URN_TYPE_HEX_COLORS[UrnType.AGENT], tailwindBg: 'bg-cyan-500' },
  { type: UrnType.PROMPT, label: 'Prompts', hexColor: URN_TYPE_HEX_COLORS[UrnType.PROMPT], tailwindBg: 'bg-purple-500' },
];
