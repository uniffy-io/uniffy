import { describe, expect, it } from "vitest";
import {
  markdownDisplayText,
  normalizeMarkdownListMarker,
  parseTableRow,
} from "@shared/lib/markdownPresentation";

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

  it("keeps an escaped mention pipe inside its table cell", () => {
    const urn = "urn:uniffy:content:TASK:01a0ed45-b8a9-7066-b996-ace8ba11c574";

    expect(parseTableRow(`| [[[Sync bug\\|${urn}]]] | Done |`)).toEqual([
      `[[[Sync bug|${urn}]]]`,
      "Done",
    ]);
    expect(parseTableRow("| a | b |")).toEqual(["a", "b"]);
  });
});
