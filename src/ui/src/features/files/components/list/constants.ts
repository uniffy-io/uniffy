export const ICON_SIZE_CONFIG = {
  0: { cardMinWidth: 100, iconSize: 32, gap: 12, showDetails: false },
  1: { cardMinWidth: 140, iconSize: 48, gap: 16, showDetails: true },
  2: { cardMinWidth: 180, iconSize: 64, gap: 20, showDetails: true },
  3: { cardMinWidth: 240, iconSize: 80, gap: 24, showDetails: true },
} as const;

export const SORT_OPTIONS = [
  { value: "updated_at", label: "Modified" },
  { value: "created_at", label: "Created" },
  { value: "filename", label: "Name" },
  { value: "size_bytes", label: "Size" },
] as const;

export type SortByValue = (typeof SORT_OPTIONS)[number]["value"];

export const SORT_ORDER_OPTIONS = [
  { value: "desc", label: "Descending" },
  { value: "asc", label: "Ascending" },
] as const;

export type SortOrderValue = (typeof SORT_ORDER_OPTIONS)[number]["value"];
