export type SystemMessageKind = "call-start" | "call-end" | "join" | "generic";

const METADATA_KINDS: Record<string, SystemMessageKind> = {
  call_started: "call-start",
  call_ended: "call-end",
  member_joined: "join",
};

/**
 * Backend-stamped metadata.kind is authoritative; the wording fallback only
 * covers messages that predate the metadata and must not grow new patterns.
 */
export function classifySystemMessage(
  content: string,
  metadata?: Record<string, unknown>,
): SystemMessageKind {
  const stamped = metadata?.["kind"];
  if (typeof stamped === "string" && METADATA_KINDS[stamped]) return METADATA_KINDS[stamped];
  const t = content.toLowerCase();
  if (t.includes("started a call")) return "call-start";
  if (t.includes("ended the call") || t.includes("call ended")) return "call-end";
  if (t.includes("joined the channel")) return "join";
  return "generic";
}
