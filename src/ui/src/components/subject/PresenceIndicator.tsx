import { cn } from "@/shared/utils/cn";

type PresenceIndicatorSize = "sm" | "md" | "lg";

interface PresenceIndicatorProps {
  status: string;
  size?: PresenceIndicatorSize;
  className?: string;
}

const SIZE_CLASSES: Record<PresenceIndicatorSize, string> = {
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3",
};

/** Positioned absolute on a `relative` parent; the card-colored ring separates the dot from the avatar edge. */
export function PresenceIndicator({ status, size = "md", className }: PresenceIndicatorProps) {
  const sizeClass = SIZE_CLASSES[size];

  if (status === "offline") {
    return (
      <span
        className={cn(
          "absolute bottom-0 right-0 rounded-full",
          "border-[1.5px] border-gray-400 dark:border-gray-500",
          "bg-transparent",
          "ring-2 ring-card",
          sizeClass,
          className,
        )}
        aria-label="Offline"
      />
    );
  }

  if (status === "dnd") {
    return (
      <span
        className={cn(
          "absolute bottom-0 right-0 rounded-full",
          "bg-red-500",
          "ring-2 ring-card",
          "flex items-center justify-center",
          sizeClass,
          className,
        )}
        aria-label="Do Not Disturb"
      >
        <span className="block w-[60%] h-[1.5px] bg-white rounded-full" />
      </span>
    );
  }

  const colorClass =
    status === "online"
      ? "bg-green-500"
      : status === "away"
        ? "bg-amber-500"
        : "bg-gray-400 dark:bg-gray-500";

  return (
    <span
      className={cn(
        "absolute bottom-0 right-0 rounded-full",
        colorClass,
        "ring-2 ring-card",
        sizeClass,
        className,
      )}
      aria-label={status === "online" ? "Online" : "Away"}
    />
  );
}
