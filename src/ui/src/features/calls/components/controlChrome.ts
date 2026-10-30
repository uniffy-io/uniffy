import { cn } from "@/shared/utils/cn";

/**
 * Call toolbar buttons in the bordered icon-box style of the channel header.
 * `compact` sits in the top nav beside its other icon boxes.
 */
export function callControlClass(compact = false) {
  return cn(
    "focus-ring inline-flex shrink-0 items-center justify-center border bg-transparent text-muted-foreground transition-colors",
    "enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-40",
    compact
      ? "size-7 rounded-md border-border-nav enabled:hover:border-primary/30"
      : "size-8 rounded-lg border-border-strong enabled:hover:bg-muted pointer-coarse:min-h-11 pointer-coarse:min-w-11",
  );
}

/** Engaged toggle (sharing, hand raised, menu open), same accent as the channel header toggles. */
export const callControlActiveClass =
  "border-primary/50 bg-primary/10 text-primary enabled:hover:border-primary/50 enabled:hover:bg-primary/15 enabled:hover:text-primary";

/** Muted mic or camera off: the same red as the mute badge on participant tiles. */
export const callControlOffClass =
  "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 enabled:hover:border-red-500/60 enabled:hover:bg-red-500/15 enabled:hover:text-red-600 dark:enabled:hover:text-red-400";

/** Row inside the call options menu: a 44px touch row that tightens on desktop like `ActionMenuItem`. */
export const callMenuItemClass =
  "focus-ring flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-9";
