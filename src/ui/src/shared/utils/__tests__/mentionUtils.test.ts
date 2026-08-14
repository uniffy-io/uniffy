import { describe, it, expect } from "vitest";
import {
  extractMentionsFromMarkdown,
  extractFallbackLabel,
  sanitizeMentionLabel,
} from "@/shared/utils/mentionUtils";

describe("extractMentionsFromMarkdown", () => {
  it("returns empty array for text without mentions", () => {
    expect(extractMentionsFromMarkdown("Hello world")).toEqual([]);
  });

  it("extracts a single mention", () => {
    const md = "Check [[[My Note|urn:uniffy:content:NOTE:abc123]]] for details.";
    const result = extractMentionsFromMarkdown(md);
    expect(result).toEqual([{ label: "My Note", urn: "urn:uniffy:content:NOTE:abc123" }]);
  });

  it("extracts multiple mentions", () => {
    const md =
      "[[[Note A|urn:uniffy:content:NOTE:aaa]]] and [[[Note B|urn:uniffy:content:NOTE:bbb]]]";
    const result = extractMentionsFromMarkdown(md);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Note A");
    expect(result[1].label).toBe("Note B");
  });

  it("deduplicates by URN", () => {
    const md = "[[[A|urn:uniffy:content:NOTE:same]]] and [[[B|urn:uniffy:content:NOTE:same]]]";
    const result = extractMentionsFromMarkdown(md);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("A");
  });

  it("handles empty string", () => {
    expect(extractMentionsFromMarkdown("")).toEqual([]);
  });

  it("handles mentions with special characters in label", () => {
    const md = "[[[John Doe (Admin)|urn:uniffy:content:USER:u1]]]";
    const result = extractMentionsFromMarkdown(md);
    expect(result[0].label).toBe("John Doe (Admin)");
  });
});

describe("sanitizeMentionLabel", () => {
  it("passes ordinary titles through", () => {
    expect(sanitizeMentionLabel("Quarterly report")).toBe("Quarterly report");
  });

  it("strips the structural characters", () => {
    expect(sanitizeMentionLabel("Q3 | Budget [DRAFT]")).toBe("Q3 Budget DRAFT");
    expect(sanitizeMentionLabel("a]]]b[[[c")).toBe("a b c");
    expect(sanitizeMentionLabel("trailing\\")).toBe("trailing");
  });

  it("falls back when nothing survives", () => {
    expect(sanitizeMentionLabel("")).toBe("mention");
    expect(sanitizeMentionLabel("[]|\\")).toBe("mention");
  });

  it("cannot mint a second mention from a hostile title", () => {
    const payload = "Alice|urn:uniffy:content:USER:u9]]] approved [[[x";
    const markup = `[[[${sanitizeMentionLabel(payload)}|urn:uniffy:content:NOTE:n1]]]`;
    const mentions = extractMentionsFromMarkdown(markup);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].urn).toBe("urn:uniffy:content:NOTE:n1");
  });
});

describe("extractFallbackLabel", () => {
  it("extracts type and truncated ID from URN", () => {
    expect(extractFallbackLabel("urn:uniffy:content:NOTE:abcdef12-3456-7890")).toBe(
      "note:abcdef12",
    );
  });

  it("handles short URN gracefully", () => {
    expect(extractFallbackLabel("urn:uniffy")).toBe("item:");
  });

  it("lowercases the type", () => {
    expect(extractFallbackLabel("urn:uniffy:content:CALENDAR_EVENT:abc")).toBe(
      "calendar_event:abc",
    );
  });
});
