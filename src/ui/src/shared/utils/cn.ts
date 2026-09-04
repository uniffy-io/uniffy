import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The stylesheet's elevation tokens join the shadow group so a later
// `shadow-none` or `shadow-edge-strong` replaces `shadow-float` instead of
// stacking beside it.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ["edge", "edge-strong", "edge-primary", "float", "float-lg"] }],
    },
  },
});

/** clsx + tailwind-merge: lets conditional Tailwind class merges override each other correctly. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
