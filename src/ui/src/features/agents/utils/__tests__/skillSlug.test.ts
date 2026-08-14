import { describe, expect, it } from "vitest";
import { deriveSkillSlug, slugifySkillName } from "@/features/agents/utils/skillSlug";

describe("slugifySkillName", () => {
  it("kebab-cases a display name", () => {
    expect(slugifySkillName("Weekly Status Report")).toBe("weekly-status-report");
  });

  it("collapses punctuation and trims separators", () => {
    expect(slugifySkillName("  Release notes: v2 (draft)!  ")).toBe("release-notes-v2-draft");
  });

  it("strips accents rather than the letter", () => {
    expect(slugifySkillName("Résumé review")).toBe("resume-review");
  });

  it("falls back when nothing survives", () => {
    expect(slugifySkillName("***")).toBe("skill");
    expect(slugifySkillName("")).toBe("skill");
  });

  it("caps at the backend name limit without a trailing separator", () => {
    const slug = slugifySkillName("a".repeat(120));
    expect(slug).toHaveLength(100);
    const spaced = slugifySkillName(`${"a".repeat(99)} tail`);
    expect(spaced.endsWith("-")).toBe(false);
  });
});

describe("deriveSkillSlug", () => {
  it("returns the plain slug when it is free", () => {
    expect(deriveSkillSlug("Weekly Report", ["other"])).toBe("weekly-report");
  });

  it("suffixes -2, -3 past existing slugs", () => {
    expect(deriveSkillSlug("Weekly Report", ["weekly-report"])).toBe("weekly-report-2");
    expect(deriveSkillSlug("Weekly Report", ["weekly-report", "weekly-report-2"])).toBe(
      "weekly-report-3",
    );
  });

  it("keeps the suffixed slug within the name limit", () => {
    const base = "a".repeat(100);
    const slug = deriveSkillSlug(base, [base]);
    expect(slug).toBe(`${"a".repeat(98)}-2`);
    expect(slug.length).toBeLessThanOrEqual(100);
  });

  it("dedupes against personal and org slugs alike", () => {
    const taken = ["weekly-report", "weekly-report-2", "weekly-report-3"];
    expect(deriveSkillSlug("weekly report", taken)).toBe("weekly-report-4");
  });
});
