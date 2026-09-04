import { cn } from "@/shared/utils/cn";

interface ToggleSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}

export function ToggleSwitch({ enabled, onChange, disabled, size = "md" }: ToggleSwitchProps) {
  const sizeClasses =
    size === "sm"
      ? { container: "h-5 w-9", knob: "h-4 w-4", translate: "translate-x-4" }
      : { container: "h-6 w-11", knob: "h-5 w-5", translate: "translate-x-5" };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      className={cn(
        "focus-ring relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
        sizeClasses.container,
        enabled ? "bg-primary" : "bg-muted",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      onClick={() => !disabled && onChange(!enabled)}
    >
      <span
        className={cn(
          "pointer-events-none inline-block transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
          sizeClasses.knob,
          enabled ? sizeClasses.translate : "translate-x-0",
        )}
      />
    </button>
  );
}
