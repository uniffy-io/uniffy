import { describe, it, expect } from "vitest";
import { buildQuoteMarkdown } from "../pdfQuote";

describe("buildQuoteMarkdown", () => {
  it("builds a blockquote with a file mention and page attribution", () => {
    const result = buildQuoteMarkdown("hello world", "report.pdf", "abc-123", 12);
    expect(result).toBe("> hello world\n>\n> [[[report.pdf|urn:uniffy:file:abc-123]]], p. 12");
  });

  it("prefixes every line of a multi-line selection", () => {
    const result = buildQuoteMarkdown("line one\nline two", "doc.pdf", "id-1", 3);
    expect(result.startsWith("> line one\n> line two\n")).toBe(true);
  });

  it("keeps empty selection lines as bare quote markers", () => {
    const result = buildQuoteMarkdown("first\n\nsecond", "doc.pdf", "id-1", 1);
    expect(result.startsWith("> first\n>\n> second")).toBe(true);
  });

  it("trims trailing whitespace per line", () => {
    const result = buildQuoteMarkdown("padded   ", "doc.pdf", "id-1", 2);
    expect(result.startsWith("> padded\n")).toBe(true);
  });
});
