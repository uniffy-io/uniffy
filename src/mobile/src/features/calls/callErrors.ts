import { ConnectError, Code } from "@connectrpc/connect";

/** Backend ValidationError wire format: "Validation error on 'field': message". */
function stripValidationPrefix(raw: string): string {
  return raw.replace(/^Validation error on '\w+':\s*/i, "").trim();
}

export function callErrorMessage(error: unknown): string {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.Unavailable:
        return "Calls aren't available on this server";
      case Code.PermissionDenied:
        return error.rawMessage || "Calls are disabled for this organization";
      case Code.NotFound:
        return "This call has already ended";
      case Code.InvalidArgument: {
        const message = stripValidationPrefix(error.rawMessage);
        if (/call has ended/i.test(message)) return "This call has already ended";
        return message || "Unable to join the call";
      }
      default:
        return error.rawMessage || "Unable to join the call";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Unable to join the call";
}
