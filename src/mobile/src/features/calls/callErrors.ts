import { CallAvailability } from "@uniffy/proto/calls/v1/calls_pb";

export const CALL_END_COPY = {
  HOST_ENDED: "The host ended the call.",
  ALL_LEFT: "Everyone left the call.",
  MAX_DURATION: "The call reached its maximum duration.",
  SOLO_TIMEOUT: "The call ended because you were alone for a while.",
  CHANNEL_ARCHIVED: "The call ended because the channel was archived.",
  ORG_SUSPENDED: "The call ended because the organization was suspended.",
  ORG_DELETED: "The call ended because the organization was deleted.",
  KICKED: "You were removed from the call.",
  DISPLACED: "This call moved to another of your devices.",
  CONNECTION_LOST:
    "The media connection was lost. Retry, or ask your administrator to check the call service and relay.",
  NETWORK_LOST: "Your network connection was lost. Connect to the internet, then rejoin.",
  UNKNOWN: "The call has ended.",
};

export const MODERATOR_MUTED_COPY =
  "A host or moderator muted your microphone. You can unmute when ready.";

export function callAvailabilityMessage(availability: CallAvailability): string | null {
  switch (availability) {
    case CallAvailability.READY:
      return null;
    case CallAvailability.DISABLED:
      return "Calls are disabled for this organization. Ask an administrator to enable them.";
    case CallAvailability.NOT_CONFIGURED:
      return "Calls are not configured on this server. Ask an administrator to set up the call service.";
    case CallAvailability.UNREACHABLE:
      return "The call service is unavailable. Try again shortly or contact an administrator.";
    default:
      return "Checking call availability...";
  }
}

export type CallDevice = "microphone" | "camera" | "screen" | "speaker";

export function callErrorMessage(error: unknown, device?: CallDevice): string {
  const record =
    typeof error === "object" && error !== null
      ? (error as { name?: string; message?: string; code?: number })
      : {};
  const name = record.name ?? "";
  const message = record.message ?? "";
  if (device === "screen") {
    if (name === "AbortError" || /cancelled|canceled|dismissed/i.test(message))
      return "Screen sharing was cancelled. Choose Share screen to try again.";
    if (
      name === "NotReadableError" ||
      name === "SecurityError" ||
      /system.*denied|permission.*system/i.test(message)
    )
      return "Screen recording is blocked by your device. Allow screen recording in system settings, then try again.";
    return "Screen sharing was not allowed. If you cancelled, try again. Otherwise allow screen recording in system settings.";
  }
  if (device) {
    const label = device[0].toUpperCase() + device.slice(1);
    if (name === "NotFoundError" || name === "DevicesNotFoundError")
      return `${label} was not found. Connect a device, select it, then try again.`;
    if (name === "NotReadableError" || name === "TrackStartError")
      return `${label} is unavailable. Close other apps using it, then try again.`;
    return `${label} access failed. Allow access in app or site settings, check system permissions, then try again. You can stay in the call without it.`;
  }
  if (/calls are disabled/i.test(message))
    return callAvailabilityMessage(CallAvailability.DISABLED)!;
  if (/not configured/i.test(message))
    return callAvailabilityMessage(CallAvailability.NOT_CONFIGURED)!;
  if (/call has ended|\[not_found\]/i.test(message) || record.code === 5)
    return "This call has already ended.";
  if (record.code === 7 || /permission_denied/i.test(message))
    return "You no longer have permission for this call or action.";
  if (record.code === 14 || /unavailable/i.test(message))
    return callAvailabilityMessage(CallAvailability.UNREACHABLE)!;
  if (/another call|already in a call/i.test(message))
    return "Leave your current call before joining another.";
  if (/full|participant limit|device limit/i.test(message))
    return "This call has reached its participant or device limit.";
  if (/network|offline|fetch/i.test(message)) return CALL_END_COPY.NETWORK_LOST;
  return "Could not complete the call action. Try again. If joining fails, ask an administrator to check the call service and relay.";
}
