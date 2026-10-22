import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import {
  CREATION_NOT_ALLOWED_MESSAGE,
  describeCreateOrganizationError,
  slugFromInput,
  slugFromName,
} from "@features/auth/createOrganizationForm";

describe("slugFromName", () => {
  it("lowercases and joins words with single hyphens", () => {
    expect(slugFromName("Acme Inc.")).toBe("acme-inc");
    expect(slugFromName("  --Hello,   World!! ")).toBe("hello-world");
    expect(slugFromName("R&D_Team 42")).toBe("r-d-team-42");
  });

  it("treats letters outside a to z as separators", () => {
    expect(slugFromName("Café Zürich")).toBe("caf-z-rich");
  });

  it("returns an empty slug when nothing usable is left", () => {
    expect(slugFromName("")).toBe("");
    expect(slugFromName(" !!! ")).toBe("");
  });

  it("leaves a valid slug unchanged", () => {
    expect(slugFromName("acme-inc")).toBe("acme-inc");
  });
});

describe("slugFromInput", () => {
  it("keeps a trailing hyphen so the next word can be typed", () => {
    expect(slugFromInput("Acme ")).toBe("acme-");
    expect(slugFromInput("acme--")).toBe("acme-");
  });

  it("drops leading hyphens and folds other characters", () => {
    expect(slugFromInput("-Acme__Co")).toBe("acme-co");
  });
});

describe("describeCreateOrganizationError", () => {
  it("places a field refusal under the field it names", () => {
    const taken = new ConnectError(
      "Validation error on 'slug': Slug is already in use",
      Code.InvalidArgument,
    );
    expect(describeCreateOrganizationError(taken)).toEqual({
      field: "slug",
      message: "Slug is already in use",
    });

    const missing = new ConnectError(
      "Validation error on 'name': name is required",
      Code.InvalidArgument,
    );
    expect(describeCreateOrganizationError(missing)).toEqual({
      field: "name",
      message: "Name is required",
    });
  });

  it("shows a refusal on another field above the form", () => {
    const error = new ConnectError(
      "Validation error on 'plan': plan is unknown",
      Code.InvalidArgument,
    );
    expect(describeCreateOrganizationError(error)).toEqual({
      field: null,
      message: "plan is unknown",
    });
  });

  it("explains a policy refusal", () => {
    const error = new ConnectError("Organization creation is not allowed", Code.PermissionDenied);
    expect(describeCreateOrganizationError(error)).toEqual({
      field: null,
      message: CREATION_NOT_ALLOWED_MESSAGE,
    });
  });

  it("never shows the text of any other failure", () => {
    const fallback = { field: null, message: "Could not create the organization. Try again." };
    expect(
      describeCreateOrganizationError(
        new ConnectError("Too many requests", Code.ResourceExhausted),
      ),
    ).toEqual(fallback);
    expect(describeCreateOrganizationError(new Error("socket hang up"))).toEqual(fallback);
  });
});
