import { describe, expect, it } from "vitest";
import { markdownDisplayText, normalizeMarkdownListMarker } from "@shared/lib/markdownPresentation";

describe("Markdown presentation", () => {
  it.each(["* one", "+ one", "- one"])("renders %j as a bullet", (line) => {
    expect(normalizeMarkdownListMarker(line)).toBe("- one");
  });

  it.each(["* [x] done", "+ [x] done", "- [x] done"])("retains task state in %j", (line) => {
    expect(normalizeMarkdownListMarker(line)).toBe("- [x] done");
  });

  it("leaves emphasis and horizontal rules intact", () => {
    expect(normalizeMarkdownListMarker("***")).toBe("***");
    expect(normalizeMarkdownListMarker("*italic*")).toBe("*italic*");
  });

  it("renders HTML breaks and escaped leading spaces", () => {
    expect(markdownDisplayText("&#x20; leading<br>next<br />last")).toBe("  leading\nnext\nlast");
  });

  it("hides image size metadata without hiding alt text", () => {
    expect(markdownDisplayText("![diagram](/image.png)<!--uniffy:image-ratio=0.75-->")).toBe(
      "![diagram](/image.png)",
    );
  });
});
