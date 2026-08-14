/** Asks once per device: an explicit dismiss persists in localStorage, and an active push subscription keeps it hidden without any flag. */

import { useCallback, useEffect, useReducer } from "react";
import { Bell, X, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { usePushSubscription } from "@/features/notifications/hooks/usePushSubscription";
import { useNotificationSettings } from "@/features/settings/hooks/useSettings";

const DISMISSED_KEY = "uniffy_push_dismissed";
const SNOOZED_KEY = "uniffy_push_snoozed";

type BannerState = { visible: boolean; subscribing: boolean; error: string | null };
type BannerAction =
  | { type: "show" }
  | { type: "hide" }
  | { type: "start_subscribe" }
  | { type: "end_subscribe"; success: boolean; error?: string };

function bannerReducer(state: BannerState, action: BannerAction): BannerState {
  switch (action.type) {
    case "show":
      return { ...state, visible: true };
    case "hide":
      return { ...state, visible: false, error: null };
    case "start_subscribe":
      return { ...state, subscribing: true, error: null };
    case "end_subscribe":
      if (action.success) {
        return { visible: false, subscribing: false, error: null };
      }
      return { visible: true, subscribing: false, error: action.error ?? null };
  }
}

function isDismissed(): boolean {
  return (
    localStorage.getItem(DISMISSED_KEY) === "true" || sessionStorage.getItem(SNOOZED_KEY) === "true"
  );
}

/** Synchronous initial visibility - avoids setState-in-effect. `granted` starts hidden; the mount effect reveals it only when no subscription exists. */
function getInitialVisibility(isSupported: boolean): boolean {
  if (!isSupported) return false;
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "default") return false;
  if (isDismissed()) return false;
  return true;
}

export function PushNotificationBanner() {
  const { subscribe, isSupported } = usePushSubscription();
  const { browserEnabled } = useNotificationSettings();
  const [state, dispatch] = useReducer(bannerReducer, isSupported, (supported) => ({
    visible: getInitialVisibility(supported),
    subscribing: false,
    error: null,
  }));

  // Permission granted but no live subscription (browser evicted it, or storage was cleared): surface the banner so push can be repaired without a browser prompt.
  useEffect(() => {
    if (!isSupported || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted" || isDismissed()) return;
    let cancelled = false;
    void (async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!cancelled && !subscription) dispatch({ type: "show" });
    })();
    return () => {
      cancelled = true;
    };
  }, [isSupported]);

  const handleEnable = useCallback(async () => {
    dispatch({ type: "start_subscribe" });
    const result = await subscribe();
    dispatch({ type: "end_subscribe", success: result.success, error: result.error });
  }, [subscribe]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, "true");
    dispatch({ type: "hide" });
  }, []);

  // Failed attempts snooze for the session only; the user likely still wants push, so retry next visit.
  useEffect(() => {
    if (!state.error) return;
    const timer = setTimeout(() => {
      sessionStorage.setItem(SNOOZED_KEY, "true");
      dispatch({ type: "hide" });
    }, 8000);
    return () => clearTimeout(timer);
  }, [state.error]);

  if (!browserEnabled) return null;
  if (!state.visible) return null;

  if (state.error) {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-2",
          "text-foreground",
          "text-sm",
        )}
        style={{
          backgroundColor: "color-mix(in srgb, var(--status-error) 10%, transparent)",
          borderBottom: "1px solid color-mix(in srgb, var(--status-error) 20%, transparent)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <WarningCircle
            size={16}
            weight="duotone"
            className="shrink-0"
            style={{ color: "var(--status-error)" }}
          />
          <span className="truncate">{state.error}</span>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          aria-label="Dismiss notification banner"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2",
        "bg-primary/10 border-b border-primary/20 text-foreground",
        "text-sm",
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Bell size={16} weight="duotone" className="shrink-0 text-primary" />
        <span className="truncate">
          Enable desktop notifications to stay updated on activity in your workspace.
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleEnable}
          disabled={state.subscribing}
          className={cn(
            "px-3 py-1 rounded-md text-xs font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:opacity-50",
          )}
        >
          {state.subscribing ? "Enabling..." : "Enable"}
        </button>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Dismiss notification banner"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
