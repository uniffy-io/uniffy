import { describe, expect, it } from "vitest";
import { changedOrganizationFields } from "@/features/admin/components/organization/organizationChanges";

const saved = { name: "Acme", slug: "acme" };

describe("changedOrganizationFields", () => {
  it("reports nothing while the draft matches the saved fields", () => {
    expect(changedOrganizationFields(saved, saved)).toEqual({});
    expect(changedOrganizationFields(saved, { name: "  Acme ", slug: "acme-" })).toEqual({});
  });

  it("holds only the fields that changed, trimmed and canonical", () => {
    expect(changedOrganizationFields(saved, { name: " Acme Labs ", slug: "acme" })).toEqual({
      name: "Acme Labs",
    });
    expect(changedOrganizationFields(saved, { name: "Acme", slug: "acme-labs-" })).toEqual({
      slug: "acme-labs",
    });
  });

  it("leaves a stored slug the current rules would rewrite alone until the user edits it", () => {
    const stored = { name: "Acme", slug: "acme_labs" };

    expect(changedOrganizationFields(stored, stored)).toEqual({});
    expect(changedOrganizationFields(stored, { ...stored, name: "Acme Labs" })).toEqual({
      name: "Acme Labs",
    });
    expect(changedOrganizationFields(stored, { ...stored, slug: "acme-labs" })).toEqual({
      slug: "acme-labs",
    });
  });
});
