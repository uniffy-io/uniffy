import { Code, ConnectError } from "@connectrpc/connect";
import { userFacingError } from "@shared/lib/userFacingError";

export type CreateOrganizationField = "name" | "slug";

export type CreateOrganizationFailure = {
  field: CreateOrganizationField | null;
  message: string;
};

export const CREATION_NOT_ALLOWED_MESSAGE =
  "Organization creation is not allowed for this account.";
const CREATE_FAILED_MESSAGE = "Could not create the organization. Try again.";
const FIELD_REFUSAL = /^Validation error on '(name|slug)': (.+)$/;

/** NFKD splits an accent off its base letter, so dropping the marks turns "Café" into "cafe". */
function foldAccents(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "");
}

export function slugFromName(name: string): string {
  return foldAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Keeps a trailing hyphen so the next word can still be typed; `slugFromName` trims it on submit. */
export function slugFromInput(value: string): string {
  return foldAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "");
}

export function describeCreateOrganizationError(error: unknown): CreateOrganizationFailure {
  if (error instanceof ConnectError) {
    if (error.code === Code.InvalidArgument) {
      const refusal = error.rawMessage.match(FIELD_REFUSAL);
      if (refusal) {
        const [, field, message] = refusal;
        return {
          field: field as CreateOrganizationField,
          message: message.charAt(0).toUpperCase() + message.slice(1),
        };
      }
    }
    if (error.code === Code.PermissionDenied) {
      return { field: null, message: CREATION_NOT_ALLOWED_MESSAGE };
    }
  }
  return { field: null, message: userFacingError(error, CREATE_FAILED_MESSAGE) };
}
