import { Alert } from "react-native";

/**
 * Native confirmation for anything that destroys data. Cancel is the default
 * button so a mis-tap on the action sheet behind it cannot delete.
 */
export function confirmDestructive({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}
