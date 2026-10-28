import { ConnectError } from "@connectrpc/connect";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";

// No generated descriptor exists for google.rpc.ErrorInfo, so its two string fields are read off
// the wire: reason is field 1, domain is field 2.
const ERROR_INFO_TYPE = "google.rpc.ErrorInfo";
const ERROR_INFO_DOMAIN = "uniffy";

function readErrorInfo(value: Uint8Array): { reason: string; domain: string } | null {
  try {
    const reader = new BinaryReader(value);
    let reason = "";
    let domain = "";
    while (reader.pos < reader.len) {
      const [field, wireType] = reader.tag();
      if (field === 1 && wireType === WireType.LengthDelimited) reason = reader.string();
      else if (field === 2 && wireType === WireType.LengthDelimited) domain = reader.string();
      else reader.skip(wireType, field);
    }
    return { reason, domain };
  } catch {
    return null;
  }
}

/** The typed reason the server attached to a refusal, such as `sign_in_required`, or null. */
export function decodeErrorReason(err: unknown): string | null {
  if (!(err instanceof ConnectError)) return null;
  for (const detail of err.details) {
    if (!("type" in detail) || detail.type !== ERROR_INFO_TYPE) continue;
    const info = readErrorInfo(detail.value);
    if (info?.domain === ERROR_INFO_DOMAIN && info.reason) return info.reason;
  }
  return null;
}
