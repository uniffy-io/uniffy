import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillCompatibilityNotice } from "@/features/agents/components/skills/SkillCompatibilityNotice";

const diagnostic = {
  skillId: "skill",
  versionId: "version",
  versionNumber: 2,
  missingTools: ["notes.read_note"],
  unsupportedSurfaces: ["chat"],
  unavailable: false,
  displayName: "Report",
  retired: false,
};

describe("skill compatibility explanations", () => {
  it("names missing capabilities and unsupported product surfaces", () => {
    const html = renderToStaticMarkup(
      createElement(SkillCompatibilityNotice, {
        diagnostic,
        toolLabels: { "notes.read_note": "Read note" },
      }),
    );
    expect(html).toContain("Required tools unavailable: Read note");
    expect(html).toContain("Not available in chat");
    expect(html).not.toContain("Test Drawer");
    expect(html).not.toContain("notes.read_note");
  });

  it("does not invent requirements for an unavailable snapshot", () => {
    const html = renderToStaticMarkup(
      createElement(SkillCompatibilityNotice, {
        diagnostic: { ...diagnostic, unavailable: true },
        toolLabels: {},
      }),
    );
    expect(html).toContain("This skill is unavailable");
    expect(html).not.toContain("Required tools");
  });
});
