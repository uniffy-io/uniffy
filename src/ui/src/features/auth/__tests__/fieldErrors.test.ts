import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { fieldErrorFor } from "@/features/auth/utils/fieldErrors";

const FIELDS = ["name", "slug"] as const;

function invalid(message: string): ConnectError {
  return new ConnectError(message, Code.InvalidArgument);
}

describe("fieldErrorFor", () => {
  it("places the message under the field the server names, capitalised", () => {
    expect(
      fieldErrorFor(
        invalid("Validation error on 'slug': slug must be 2-255 characters of lowercase letters"),
        FIELDS,
      ),
    ).toEqual({ field: "slug", message: "Slug must be 2-255 characters of lowercase letters" });
    expect(fieldErrorFor(invalid("Validation error on 'name': name is required"), FIELDS)).toEqual({
      field: "name",
      message: "Name is required",
    });
  });

  it("falls back to the field the message mentions first, then to the first field", () => {
    expect(fieldErrorFor(invalid("The slug is already taken by name"), FIELDS)?.field).toBe("slug");
    expect(
      fieldErrorFor(invalid("Validation error on 'lookup': name or slug required"), FIELDS)?.field,
    ).toBe("name");
    expect(fieldErrorFor(invalid("value is too long"), FIELDS)).toEqual({
      field: "name",
      message: "Value is too long",
    });
  });

  it("leaves every other error to the caller", () => {
    expect(
      fieldErrorFor(new ConnectError("slug is reserved", Code.PermissionDenied), FIELDS),
    ).toBeNull();
    expect(fieldErrorFor(new Error("slug"), FIELDS)).toBeNull();
    expect(fieldErrorFor(invalid("slug is reserved"), [])).toBeNull();
  });
});
