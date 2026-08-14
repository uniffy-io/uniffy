import { MemoryCategory } from "@uniffy/proto/agents/v1/memories_pb";

export const CATEGORY_LABELS: Record<number, string> = {
  [MemoryCategory.UNSPECIFIED]: "Unspecified",
  [MemoryCategory.PREFERENCES]: "Preferences",
  [MemoryCategory.FACTS]: "Facts",
  [MemoryCategory.CONTEXT]: "Context",
  [MemoryCategory.INSTRUCTIONS]: "Instructions",
};

export const CATEGORY_BADGE_CLASSES: Record<number, string> = {
  [MemoryCategory.PREFERENCES]:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-transparent",
  [MemoryCategory.FACTS]:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-transparent",
  [MemoryCategory.CONTEXT]:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-transparent",
  [MemoryCategory.INSTRUCTIONS]:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-transparent",
};

export const CATEGORY_FILTER_OPTIONS = [
  { value: "all", label: "All categories" },
  { value: String(MemoryCategory.PREFERENCES), label: "Preferences" },
  { value: String(MemoryCategory.FACTS), label: "Facts" },
  { value: String(MemoryCategory.CONTEXT), label: "Context" },
  { value: String(MemoryCategory.INSTRUCTIONS), label: "Instructions" },
];

export const CATEGORY_EDIT_OPTIONS = [
  { value: String(MemoryCategory.PREFERENCES), label: "Preferences" },
  { value: String(MemoryCategory.FACTS), label: "Facts" },
  { value: String(MemoryCategory.CONTEXT), label: "Context" },
  { value: String(MemoryCategory.INSTRUCTIONS), label: "Instructions" },
];

export function getCategoryBadgeClass(category: number): string {
  return CATEGORY_BADGE_CLASSES[category] ?? "bg-muted text-muted-foreground border-transparent";
}
