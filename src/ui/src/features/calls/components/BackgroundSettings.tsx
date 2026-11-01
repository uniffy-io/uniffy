import { useEffect, useState } from "react";
import { useAppSelector } from "@/app/hooks";
import { Select } from "@/components/ui/select";
import { controlShellClass } from "@/components/ui/input";
import { cn } from "@/shared/utils/cn";
import { useCall } from "@/features/calls/components/callContext";
import { selectCallPreferences } from "@/features/calls/store/callPreferencesSlice";

export function BackgroundSettings({
  disabled = false,
  inline = false,
}: {
  disabled?: boolean;
  inline?: boolean;
}) {
  const { backgroundBlur = false } = useAppSelector(selectCallPreferences);
  const { setBackgroundBlur } = useCall();
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("@/features/calls/utils/blurProcessor")
      .then((module) => {
        if (!cancelled) setSupported(module.blurSupported());
      })
      .catch(() => {
        if (!cancelled) setSupported(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="space-y-1">
      <div className="grid items-center gap-1 sm:grid-cols-[6rem_1fr] sm:gap-3">
        <span className="text-sm text-muted-foreground">Background</span>
        {inline ? (
          <select
            aria-label="Camera background"
            value={backgroundBlur ? "blur" : "off"}
            disabled={disabled || (supported !== true && !backgroundBlur)}
            onChange={(event) => void setBackgroundBlur(event.target.value === "blur")}
            className={cn(
              controlShellClass,
              "focus-ring min-h-11 w-full px-2 text-sm text-foreground lg:min-h-9",
            )}
          >
            <option value="off">Off</option>
            <option value="blur" disabled={supported !== true}>
              Blur
            </option>
          </select>
        ) : (
          <Select
            ariaLabel="Camera background"
            value={backgroundBlur ? "blur" : "off"}
            onChange={(value) => {
              if (value === "off" || supported) void setBackgroundBlur(value === "blur");
            }}
            disabled={disabled || (supported !== true && !backgroundBlur)}
            options={[
              { value: "off", label: "Off" },
              { value: "blur", label: "Blur" },
            ]}
            className="min-w-0"
            triggerClassName="w-full min-w-0"
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {supported === false
          ? "Blur is unavailable in this browser."
          : supported === null
            ? "Checking blur support..."
            : "Blur your surroundings. Saved on this device."}
      </p>
      {backgroundBlur && (
        <p className="text-xs text-muted-foreground" role="status">
          Background blur runs entirely on your device. It can slow things down, make your device
          warmer, and use more battery. Turn blur off if your device gets too hot or calls feel
          slow.
        </p>
      )}
    </div>
  );
}
