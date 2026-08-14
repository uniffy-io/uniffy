/** Resolver for the 12-slug palette; null/unknown falls back to workspace accent. No hash-derived fallback. */

export interface TagChipClasses {
  bg: string;
  text: string;
  border: string;
  swatch: string;
}

export const TAG_PALETTE_SLUGS = [
  "slate",
  "gray",
  "red",
  "orange",
  "amber",
  "yellow",
  "green",
  "emerald",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;

export type TagPaletteSlug = (typeof TAG_PALETTE_SLUGS)[number];

const ACCENT_CLASSES: TagChipClasses = {
  bg: "bg-primary/10 dark:bg-primary/20",
  text: "text-primary",
  border: "border-primary/40 dark:border-primary/30",
  swatch: "bg-primary",
};

const PALETTE: Record<TagPaletteSlug, TagChipClasses> = {
  slate: {
    bg: "bg-slate-100 dark:bg-slate-900/40",
    text: "text-slate-700 dark:text-slate-200",
    border: "border-slate-300 dark:border-slate-700",
    swatch: "bg-slate-500",
  },
  gray: {
    bg: "bg-gray-100 dark:bg-gray-900/40",
    text: "text-gray-700 dark:text-gray-200",
    border: "border-gray-300 dark:border-gray-700",
    swatch: "bg-gray-500",
  },
  red: {
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-800 dark:text-red-300",
    border: "border-red-300 dark:border-red-800",
    swatch: "bg-red-500",
  },
  orange: {
    bg: "bg-orange-100 dark:bg-orange-900/30",
    text: "text-orange-800 dark:text-orange-300",
    border: "border-orange-300 dark:border-orange-800",
    swatch: "bg-orange-500",
  },
  amber: {
    bg: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-800 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-800",
    swatch: "bg-amber-500",
  },
  yellow: {
    bg: "bg-yellow-100 dark:bg-yellow-900/30",
    text: "text-yellow-800 dark:text-yellow-200",
    border: "border-yellow-300 dark:border-yellow-800",
    swatch: "bg-yellow-500",
  },
  green: {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-800 dark:text-green-300",
    border: "border-green-300 dark:border-green-800",
    swatch: "bg-green-500",
  },
  emerald: {
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    text: "text-emerald-800 dark:text-emerald-300",
    border: "border-emerald-300 dark:border-emerald-800",
    swatch: "bg-emerald-500",
  },
  teal: {
    bg: "bg-teal-100 dark:bg-teal-900/30",
    text: "text-teal-800 dark:text-teal-300",
    border: "border-teal-300 dark:border-teal-800",
    swatch: "bg-teal-500",
  },
  blue: {
    bg: "bg-blue-100 dark:bg-blue-900/30",
    text: "text-blue-800 dark:text-blue-300",
    border: "border-blue-300 dark:border-blue-800",
    swatch: "bg-blue-500",
  },
  violet: {
    bg: "bg-violet-100 dark:bg-violet-900/30",
    text: "text-violet-800 dark:text-violet-300",
    border: "border-violet-300 dark:border-violet-800",
    swatch: "bg-violet-500",
  },
  pink: {
    bg: "bg-pink-100 dark:bg-pink-900/30",
    text: "text-pink-800 dark:text-pink-300",
    border: "border-pink-300 dark:border-pink-800",
    swatch: "bg-pink-500",
  },
};

export function isTagPaletteSlug(value: string): value is TagPaletteSlug {
  return (TAG_PALETTE_SLUGS as readonly string[]).includes(value);
}

export function tagColorClasses(_slug: string, color?: string | null): TagChipClasses {
  if (color && isTagPaletteSlug(color.toLowerCase())) {
    return PALETTE[color.toLowerCase() as TagPaletteSlug];
  }
  return ACCENT_CLASSES;
}

export function getPaletteEntry(slug: TagPaletteSlug): TagChipClasses {
  return PALETTE[slug];
}
