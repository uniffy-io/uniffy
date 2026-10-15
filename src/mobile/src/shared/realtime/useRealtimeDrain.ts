import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "@core/providers/AuthContext";
import { onUserSignOut } from "@core/auth/sessionEvents";
import { addOnlineListener } from "@core/api/connectivity";
import { clearUserDrafts, resumeDraftStorage } from "@shared/realtime/draftStorage";
import { runMobileDrain, stopMobileDrains } from "@shared/realtime/drain";

export function useRealtimeDrain(): void {
  const { user, organizationId } = useAuth();
  useEffect(
    () =>
      onUserSignOut(async (userId) => {
        stopMobileDrains();
        await clearUserDrafts(userId);
      }),
    [],
  );
  useEffect(() => {
    if (!user?.id || !organizationId) return;
    resumeDraftStorage(user.id);
    let active = true;
    const kick = () =>
      void runMobileDrain(user.id, organizationId, () => active).catch(console.warn);
    kick();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") kick();
    });
    const online = addOnlineListener((connected) => {
      if (connected) kick();
    });
    const interval = setInterval(kick, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
      appState.remove();
      online();
      stopMobileDrains();
    };
  }, [user?.id, organizationId]);
}
