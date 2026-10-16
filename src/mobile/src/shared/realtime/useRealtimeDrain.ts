import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "@core/providers/AuthContext";
import { onUnsyncedEditsCheck, onUserSignOut } from "@core/auth/sessionEvents";
import { addOnlineListener } from "@core/api/connectivity";
import { resumeDraftStorage } from "@shared/realtime/draftStorage";
import {
  handOffSavedDrafts,
  runMobileDrain,
  settleUnsyncedEdits,
  signOutDrafts,
  stopMobileDrains,
} from "@shared/realtime/drain";

export function useRealtimeDrain(): void {
  const { user, organizationId } = useAuth();
  useEffect(() => onUserSignOut(signOutDrafts), []);
  useEffect(() => onUnsyncedEditsCheck(settleUnsyncedEdits), []);
  useEffect(() => {
    if (!user?.id || !organizationId) return;
    resumeDraftStorage(user.id);
    let active = true;
    const isActive = () => active;
    const kick = () => void runMobileDrain(user.id, organizationId, isActive).catch(console.warn);
    kick();
    const handOff = handOffSavedDrafts(user.id, organizationId, isActive);
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
      handOff();
      appState.remove();
      online();
      stopMobileDrains();
    };
  }, [user?.id, organizationId]);
}
