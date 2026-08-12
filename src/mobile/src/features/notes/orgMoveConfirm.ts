import { Alert } from "react-native";

/**
 * One confirm dialog for every surface that widens a note to the organization
 * (move sheet, drag-and-drop), so the warning copy cannot drift.
 */
export function confirmOrgMove(onConfirm: () => void): void {
  Alert.alert(
    "Move to Organization",
    "Everyone in the organization will be able to see this note, along with anything it references - attached files, mentioned notes and inline media.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Move to Organization", onPress: onConfirm },
    ],
  );
}
