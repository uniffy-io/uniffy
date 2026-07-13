import { ConnectError, Code } from "@connectrpc/connect";

export function callErrorMessage(error: unknown): string {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.Unavailable:
        return "Calls aren't available on this server";
      case Code.PermissionDenied:
        return error.rawMessage || "Calls are disabled for this organization";
      case Code.NotFound:
        return "This call has already ended";
      case Code.InvalidArgument:
        return error.rawMessage || "Unable to join the call";
      default:
        return error.rawMessage || "Unable to join the call";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Unable to join the call";
}
