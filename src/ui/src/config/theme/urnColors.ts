import { UrnType } from "@/shared/utils/urnTypes";
import { brandRampStops, type BrandStops } from "@/config/theme/brandGradients";

/** Hex color values for canvas/SVG rendering (graphs, charts). */
export const URN_TYPE_HEX_COLORS: Record<UrnType, string> = {
  [UrnType.NOTE]: "#8b5cf6", // violet-500 (fallback, usually uses primary)
  [UrnType.FILE]: "#3b82f6", // blue-500
  [UrnType.FOLDER]: "#f59e0b", // amber-500
  [UrnType.CHAT]: "#8b5cf6", // violet-500
  [UrnType.AGENT_CHAT]: "#06b6d4", // cyan-500 (matches AGENT)
  [UrnType.AGENT_FOLDER]: "#06b6d4", // cyan-500 (container of agent chats)
  [UrnType.USER]: "#10b981", // emerald-500
  [UrnType.TEAM]: "#a855f7", // purple-500 (people-adjacent, near violet)
  [UrnType.CALENDAR_EVENT]: "#f43f5e", // rose-500
  [UrnType.PROJECT]: "#f97316", // orange-500
  [UrnType.TASK]: "#14b8a6", // teal-500
  [UrnType.AGENT]: "#06b6d4", // cyan-500
  [UrnType.AGENT_CRON_TASK]: "#6366f1", // indigo-500
  [UrnType.ROOM]: "#0ea5e9", // sky-500
  [UrnType.CHAT_MESSAGE]: "#8b5cf6", // violet-500 (same as chat)
  [UrnType.TAG]: "#64748b", // slate-500 (per-tag color overrides at chip level)
  [UrnType.UNKNOWN]: "#6b7280", // gray-500
};

export interface UrnTypeTheme {
  /** Solid type-color box with white icon. */
  iconBg: string;
  /** Accent-tinted icon box (border + faint bg + accent-colored icon). */
  iconBoxAccent: string;
  accentText: string;
  badgeBg: string;
  border: string;
  /** Hover tint for flat pill borders. */
  borderHover: string;
  /** Outer glow color for hover states. */
  shadow: string;
}

export const URN_TYPE_THEMES: Record<UrnType, UrnTypeTheme> = {
  [UrnType.NOTE]: {
    iconBg: "bg-gradient-to-br from-primary to-primary/80",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-primary",
    badgeBg: "bg-primary/10",
    border: "border-primary/40 dark:border-primary/20",
    borderHover: "hover:border-primary/60 dark:hover:border-primary/40",
    shadow: "shadow-primary/50",
  },
  [UrnType.FILE]: {
    iconBg: "bg-gradient-to-br from-blue-500 to-blue-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-blue-600 dark:text-blue-400",
    badgeBg: "bg-blue-500/10",
    border: "border-blue-500/40 dark:border-blue-500/20",
    borderHover: "hover:border-blue-500/60 dark:hover:border-blue-500/40",
    shadow: "shadow-blue-500/50",
  },
  [UrnType.FOLDER]: {
    iconBg: "bg-gradient-to-br from-amber-500 to-amber-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-amber-600 dark:text-amber-400",
    badgeBg: "bg-amber-500/10",
    border: "border-amber-500/40 dark:border-amber-500/20",
    borderHover: "hover:border-amber-500/60 dark:hover:border-amber-500/40",
    shadow: "shadow-amber-500/50",
  },
  [UrnType.AGENT_FOLDER]: {
    iconBg: "bg-gradient-to-br from-cyan-500 to-cyan-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-cyan-600 dark:text-cyan-400",
    badgeBg: "bg-cyan-500/10",
    border: "border-cyan-500/40 dark:border-cyan-500/20",
    borderHover: "hover:border-cyan-500/60 dark:hover:border-cyan-500/40",
    shadow: "shadow-cyan-500/50",
  },
  [UrnType.CHAT]: {
    iconBg: "bg-gradient-to-br from-violet-500 to-violet-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-violet-600 dark:text-violet-400",
    badgeBg: "bg-violet-500/10",
    border: "border-violet-500/40 dark:border-violet-500/20",
    borderHover: "hover:border-violet-500/60 dark:hover:border-violet-500/40",
    shadow: "shadow-violet-500/50",
  },
  [UrnType.USER]: {
    iconBg: "bg-gradient-to-br from-emerald-500 to-emerald-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-emerald-600 dark:text-emerald-400",
    badgeBg: "bg-emerald-500/10",
    border: "border-emerald-500/40 dark:border-emerald-500/20",
    borderHover: "hover:border-emerald-500/60 dark:hover:border-emerald-500/40",
    shadow: "shadow-emerald-500/50",
  },
  [UrnType.TEAM]: {
    iconBg: "bg-gradient-to-br from-purple-500 to-purple-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-purple-600 dark:text-purple-400",
    badgeBg: "bg-purple-500/10",
    border: "border-purple-500/40 dark:border-purple-500/20",
    borderHover: "hover:border-purple-500/60 dark:hover:border-purple-500/40",
    shadow: "shadow-purple-500/50",
  },
  [UrnType.CALENDAR_EVENT]: {
    iconBg: "bg-gradient-to-br from-rose-500 to-rose-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-rose-600 dark:text-rose-400",
    badgeBg: "bg-rose-500/10",
    border: "border-rose-500/40 dark:border-rose-500/20",
    borderHover: "hover:border-rose-500/60 dark:hover:border-rose-500/40",
    shadow: "shadow-rose-500/50",
  },
  [UrnType.PROJECT]: {
    iconBg: "bg-gradient-to-br from-orange-500 to-orange-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-orange-600 dark:text-orange-400",
    badgeBg: "bg-orange-500/10",
    border: "border-orange-500/40 dark:border-orange-500/20",
    borderHover: "hover:border-orange-500/60 dark:hover:border-orange-500/40",
    shadow: "shadow-orange-500/50",
  },
  [UrnType.TASK]: {
    iconBg: "bg-gradient-to-br from-teal-500 to-teal-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-teal-600 dark:text-teal-400",
    badgeBg: "bg-teal-500/10",
    border: "border-teal-500/40 dark:border-teal-500/20",
    borderHover: "hover:border-teal-500/60 dark:hover:border-teal-500/40",
    shadow: "shadow-teal-500/50",
  },
  [UrnType.AGENT]: {
    iconBg: "bg-gradient-to-br from-cyan-500 to-cyan-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-cyan-600 dark:text-cyan-400",
    badgeBg: "bg-cyan-500/10",
    border: "border-cyan-500/40 dark:border-cyan-500/20",
    borderHover: "hover:border-cyan-500/60 dark:hover:border-cyan-500/40",
    shadow: "shadow-cyan-500/50",
  },
  [UrnType.AGENT_CRON_TASK]: {
    iconBg: "bg-gradient-to-br from-indigo-500 to-indigo-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-indigo-600 dark:text-indigo-400",
    badgeBg: "bg-indigo-500/10",
    border: "border-indigo-500/40 dark:border-indigo-500/20",
    borderHover: "hover:border-indigo-500/60 dark:hover:border-indigo-500/40",
    shadow: "shadow-indigo-500/50",
  },
  [UrnType.ROOM]: {
    iconBg: "bg-gradient-to-br from-sky-500 to-sky-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-sky-600 dark:text-sky-400",
    badgeBg: "bg-sky-500/10",
    border: "border-sky-500/40 dark:border-sky-500/20",
    borderHover: "hover:border-sky-500/60 dark:hover:border-sky-500/40",
    shadow: "shadow-sky-500/50",
  },
  [UrnType.AGENT_CHAT]: {
    iconBg: "bg-gradient-to-br from-cyan-500 to-cyan-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-cyan-600 dark:text-cyan-400",
    badgeBg: "bg-cyan-500/10",
    border: "border-cyan-500/40 dark:border-cyan-500/20",
    borderHover: "hover:border-cyan-500/60 dark:hover:border-cyan-500/40",
    shadow: "shadow-cyan-500/50",
  },
  [UrnType.CHAT_MESSAGE]: {
    iconBg: "bg-gradient-to-br from-violet-500 to-violet-600",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-violet-600 dark:text-violet-400",
    badgeBg: "bg-violet-500/10",
    border: "border-violet-500/40 dark:border-violet-500/20",
    borderHover: "hover:border-violet-500/60 dark:hover:border-violet-500/40",
    shadow: "shadow-violet-500/50",
  },
  [UrnType.TAG]: {
    iconBg: "bg-gradient-to-br from-slate-400 to-slate-500",
    iconBoxAccent: "border border-primary/55 bg-primary/10 text-primary",
    accentText: "text-primary",
    badgeBg: "bg-primary/10",
    border: "border-primary/40 dark:border-primary/20",
    borderHover: "hover:border-primary/60 dark:hover:border-primary/40",
    shadow: "shadow-primary/40",
  },
  [UrnType.UNKNOWN]: {
    iconBg: "bg-gradient-to-br from-gray-400 to-gray-500",
    iconBoxAccent: "border border-muted-foreground/40 bg-muted text-muted-foreground",
    accentText: "text-muted-foreground",
    badgeBg: "bg-gray-500/10",
    border: "border-gray-500/40 dark:border-gray-500/20",
    borderHover: "hover:border-gray-500/60 dark:hover:border-gray-500/40",
    shadow: "shadow-gray-500/50",
  },
};

export function getUrnTypeHexColor(type: UrnType): string {
  return URN_TYPE_HEX_COLORS[type] || URN_TYPE_HEX_COLORS[UrnType.UNKNOWN];
}

export function getUrnTypeTheme(type: UrnType): UrnTypeTheme {
  return URN_TYPE_THEMES[type] || URN_TYPE_THEMES[UrnType.UNKNOWN];
}

/**
 * Order the brand-axis ramp walks, violet end to pink end. Content types that
 * belong together sit next to each other, so neighbouring hues read as related
 * rather than arbitrary. Appending a type here shifts every later slice, which
 * is fine - the ramp is a sweep, not a set of fixed identities.
 */
const BRAND_RAMP_ORDER: readonly UrnType[] = [
  UrnType.NOTE,
  UrnType.TAG,
  UrnType.FOLDER,
  UrnType.FILE,
  UrnType.PROJECT,
  UrnType.TASK,
  UrnType.CALENDAR_EVENT,
  UrnType.ROOM,
  UrnType.CHAT,
  UrnType.CHAT_MESSAGE,
  UrnType.AGENT_FOLDER,
  UrnType.AGENT_CHAT,
  UrnType.AGENT_CRON_TASK,
  UrnType.AGENT,
  UrnType.TEAM,
  UrnType.USER,
];

/**
 * Stops a URN type is painted with on canvas surfaces. The whole graph is one
 * Unity Violet -> Belonging Pink sweep instead of a set of unrelated hues, so
 * position on the axis carries the type while shape and icon still separate
 * them. Deliberately independent of the viewer's accent: like identity paint,
 * the canvas has to look the same to everyone reading it.
 */
export function getUrnTypeBrandStops(type: UrnType): BrandStops {
  const index = BRAND_RAMP_ORDER.indexOf(type);
  if (index === -1) {
    return {
      start: URN_TYPE_HEX_COLORS[UrnType.UNKNOWN],
      end: URN_TYPE_HEX_COLORS[UrnType.UNKNOWN],
    };
  }
  return brandRampStops(index, BRAND_RAMP_ORDER.length);
}

export const URN_TYPE_LEGEND: Array<{
  type: UrnType;
  label: string;
  hexColor: string;
  tailwindBg: string;
}> = [
  {
    type: UrnType.NOTE,
    label: "Notes",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.NOTE],
    tailwindBg: "bg-primary",
  },
  {
    type: UrnType.USER,
    label: "Users",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.USER],
    tailwindBg: "bg-emerald-500",
  },
  {
    type: UrnType.TEAM,
    label: "Teams",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.TEAM],
    tailwindBg: "bg-purple-500",
  },
  {
    type: UrnType.FILE,
    label: "Files",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.FILE],
    tailwindBg: "bg-blue-500",
  },
  {
    type: UrnType.FOLDER,
    label: "Folders",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.FOLDER],
    tailwindBg: "bg-amber-500",
  },
  {
    type: UrnType.CHAT,
    label: "Chats",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.CHAT],
    tailwindBg: "bg-violet-500",
  },
  {
    type: UrnType.AGENT_CHAT,
    label: "Agent Chats",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.AGENT_CHAT],
    tailwindBg: "bg-cyan-500",
  },
  {
    type: UrnType.CALENDAR_EVENT,
    label: "Events",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.CALENDAR_EVENT],
    tailwindBg: "bg-rose-500",
  },
  {
    type: UrnType.PROJECT,
    label: "Projects",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.PROJECT],
    tailwindBg: "bg-orange-500",
  },
  {
    type: UrnType.TASK,
    label: "Tasks",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.TASK],
    tailwindBg: "bg-teal-500",
  },
  {
    type: UrnType.AGENT,
    label: "Agents",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.AGENT],
    tailwindBg: "bg-cyan-500",
  },
  {
    type: UrnType.ROOM,
    label: "Rooms",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.ROOM],
    tailwindBg: "bg-sky-500",
  },
  {
    type: UrnType.TAG,
    label: "Tags",
    hexColor: URN_TYPE_HEX_COLORS[UrnType.TAG],
    tailwindBg: "bg-slate-500",
  },
];
