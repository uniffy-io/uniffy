import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useAuth } from "@core/providers/AuthContext";

function confirmDiscard(): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      "Unsaved edits",
      "Some edits on this device are not saved yet. Signing out deletes them.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Sign out", style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

/** Signs out, asking first when edits only this device holds would be deleted. Resolves true
 * once signed out. Checking can wait a few seconds for pending edits to save. */
export function useSignOut(): { signOut: () => Promise<boolean>; signingOut: boolean } {
  const { logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = useCallback(() => {
    setSigningOut(true);
    return logout()
      .then(async (done) => done || ((await confirmDiscard()) && logout({ discardUnsynced: true })))
      .finally(() => setSigningOut(false));
  }, [logout]);
  return { signOut, signingOut };
}
