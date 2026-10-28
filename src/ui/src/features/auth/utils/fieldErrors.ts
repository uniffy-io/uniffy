import { Code, ConnectError } from "@connectrpc/connect";
import { friendlyErrorMessage } from "@/config/errorMessages";

/** Mirrors the organization name bound in domains/organizations/naming.py. */
export const MAX_ORGANIZATION_NAME_LENGTH = 255;

const NAMED_FIELD = /Validation error on '(\w+)'/i;
const FALLBACK_MESSAGE = "This value is not valid.";

/** The field the message mentions first, as a whole word. */
function firstMentioned<F extends string>(message: string, fields: readonly F[]): F | undefined {
  let first: { field: F; index: number } | undefined;
  for (const field of fields) {
    const index = message.search(new RegExp(`\\b${field}\\b`, "i"));
    if (index !== -1 && (!first || index < first.index)) first = { field, index };
  }
  return first?.field;
}

/**
 * Places an INVALID_ARGUMENT under the input it concerns: the field the server names, else the
 * first field the message mentions, else the first of `fields`. Null for any other error.
 */
export function fieldErrorFor<F extends string>(
  error: unknown,
  fields: readonly F[],
): { field: F; message: string } | null {
  if (!(error instanceof ConnectError) || error.code !== Code.InvalidArgument) return null;
  const raw = error.rawMessage;
  const named = raw.match(NAMED_FIELD)?.[1]?.toLowerCase();
  const field =
    fields.find((candidate) => candidate.toLowerCase() === named) ??
    firstMentioned(raw, fields) ??
    fields[0];
  if (field === undefined) return null;
  const message = friendlyErrorMessage(error.message) ?? FALLBACK_MESSAGE;
  return { field, message: message.charAt(0).toUpperCase() + message.slice(1) };
}
