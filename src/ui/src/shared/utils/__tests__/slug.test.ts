import { describe, expect, it } from "vitest";
import { MAX_SLUG_LENGTH, toSlug, toSlugDraft } from "@/shared/utils/slug";

describe("toSlugDraft", () => {
  it("keeps a trailing hyphen so the next word can follow it", () => {
    expect(toSlugDraft("Acme ")).toBe("acme-");
    expect(toSlugDraft("  Acme Inc")).toBe("acme-inc");
  });

  it("folds accented letters onto their base letter", () => {
    expect(toSlugDraft("Café Müller")).toBe("cafe-muller");
    expect(toSlugDraft("Škoda Dvořák")).toBe("skoda-dvorak");
  });

  it("caps the slug at the server's bound", () => {
    expect(toSlugDraft("a".repeat(MAX_SLUG_LENGTH + 10))).toHaveLength(MAX_SLUG_LENGTH);
  });
});

describe("toSlug", () => {
  it("drops the trailing hyphen and anything that is not a letter or digit", () => {
    expect(toSlug("Acme, Inc. ")).toBe("acme-inc");
    expect(toSlug("under_score")).toBe("under-score");
  });

  it("folds compatibility forms and accents the way skill slugs do", () => {
    expect(toSlug("Ｒésumé ２０２６")).toBe("resume-2026");
  });

  it("leaves nothing for a name without a letter or digit", () => {
    expect(toSlug("---")).toBe("");
    expect(toSlug("日本")).toBe("");
  });
});
