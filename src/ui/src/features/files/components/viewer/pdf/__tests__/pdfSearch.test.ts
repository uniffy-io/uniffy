import { describe, it, expect } from "vitest";
import { normalize, findMatchesInText, highlightTextItem } from "../pdfSearch";

describe("normalize", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalize("  Hello\n  World\t!")).toBe("hello world !");
  });
});

describe("findMatchesInText", () => {
  it("counts case-insensitively", () => {
    expect(findMatchesInText("Foo foo FOO", "foo")).toBe(3);
  });

  it("collapses whitespace on both sides", () => {
    expect(findMatchesInText("hello   world", "hello world")).toBe(1);
    expect(findMatchesInText("hello world", "hello   world")).toBe(1);
  });

  it("counts non-overlapping occurrences only", () => {
    expect(findMatchesInText("aaaa", "aa")).toBe(2);
  });

  it("returns 0 for empty or whitespace-only queries", () => {
    expect(findMatchesInText("anything", "")).toBe(0);
    expect(findMatchesInText("anything", "   ")).toBe(0);
  });

  it("returns 0 when there is no match", () => {
    expect(findMatchesInText("hello world", "goodbye")).toBe(0);
  });
});

describe("highlightTextItem", () => {
  it("wraps matches in mark tags", () => {
    expect(highlightTextItem("say hello twice hello", "hello")).toBe(
      'say <mark class="viewer-pdf-hit">hello</mark> twice <mark class="viewer-pdf-hit">hello</mark>',
    );
  });

  it("matches case-insensitively and preserves original casing", () => {
    expect(highlightTextItem("Hello World", "hello")).toBe(
      '<mark class="viewer-pdf-hit">Hello</mark> World',
    );
  });

  it("escapes HTML outside matches", () => {
    expect(highlightTextItem("a < b & c", "b")).toBe(
      'a &lt; <mark class="viewer-pdf-hit">b</mark> &amp; c',
    );
  });

  it("escapes HTML inside matches", () => {
    expect(highlightTextItem("x <& y", "<&")).toBe(
      'x <mark class="viewer-pdf-hit">&lt;&amp;</mark> y',
    );
  });

  it("escapes everything when the query is empty", () => {
    expect(highlightTextItem("<script>", "")).toBe("&lt;script&gt;");
  });
});
