import { Alert } from "react-native";

/**
 * Why the call button stopped working. Without this the affordance simply
 * disappears after a refused join, which reads as a broken app rather than as a
 * deployment without LiveKit or an organization with calls switched off.
 */
export function showCallsUnavailable(reason: string): void {
  Alert.alert("Calls unavailable", reason);
}
