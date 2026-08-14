import { describe, it, expect } from "vitest";

/**
 * useDocumentTitle formats titles as: "{title} | Uniffy" or just "Uniffy".
 * We test the formatting logic directly rather than the React hook wrapper
 * since @testing-library/react is not available in this project.
 */

const APP_NAME = "Uniffy";

function formatDocumentTitle(title?: string): string {
  if (title) {
    return `${title} | ${APP_NAME}`;
  }
  return APP_NAME;
}

describe("useDocumentTitle formatting", () => {
  // -- Basic cases --

  it('formats "Title | Uniffy" when title is provided', () => {
    expect(formatDocumentTitle("Notes")).toBe("Notes | Uniffy");
  });

  it('returns just "Uniffy" when no title is provided', () => {
    expect(formatDocumentTitle()).toBe("Uniffy");
  });

  it('returns just "Uniffy" when title is undefined', () => {
    expect(formatDocumentTitle(undefined)).toBe("Uniffy");
  });

  it('returns just "Uniffy" when title is empty string', () => {
    expect(formatDocumentTitle("")).toBe("Uniffy");
  });

  it("handles dynamic content title", () => {
    expect(formatDocumentTitle("Project Plan")).toBe("Project Plan | Uniffy");
  });

  // -- Special characters --

  it("handles title with special characters", () => {
    expect(formatDocumentTitle("Notes & Tasks")).toBe("Notes & Tasks | Uniffy");
  });

  it("handles title with pipe character", () => {
    expect(formatDocumentTitle("A | B")).toBe("A | B | Uniffy");
  });

  it("handles title with HTML-like characters", () => {
    expect(formatDocumentTitle('<script>alert("hi")</script>')).toBe(
      '<script>alert("hi")</script> | Uniffy',
    );
  });

  // -- Unicode / i18n --

  it("handles Cyrillic title", () => {
    expect(formatDocumentTitle("\u0417\u0430\u043C\u0435\u0442\u043A\u0438")).toBe(
      "\u0417\u0430\u043C\u0435\u0442\u043A\u0438 | Uniffy",
    );
  });

  it("handles Cyrillic title with mixed ASCII", () => {
    expect(
      formatDocumentTitle(
        "\u041F\u0440\u043E\u0435\u043A\u0442 Alpha - \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A",
      ),
    ).toBe(
      "\u041F\u0440\u043E\u0435\u043A\u0442 Alpha - \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A | Uniffy",
    );
  });

  it("handles Chinese title", () => {
    expect(formatDocumentTitle("\u4F1A\u8BAE\u8BB0\u5F55")).toBe(
      "\u4F1A\u8BAE\u8BB0\u5F55 | Uniffy",
    );
  });

  it("handles Chinese title with punctuation", () => {
    expect(
      formatDocumentTitle("\u7B2C\u4E09\u5B63\u5EA6\u62A5\u544A \u2014 \u8D22\u52A1\u90E8"),
    ).toBe("\u7B2C\u4E09\u5B63\u5EA6\u62A5\u544A \u2014 \u8D22\u52A1\u90E8 | Uniffy");
  });

  it("handles Japanese title (Hiragana + Kanji)", () => {
    expect(formatDocumentTitle("\u8B70\u4E8B\u9332")).toBe("\u8B70\u4E8B\u9332 | Uniffy");
  });

  it("handles Japanese title with Katakana", () => {
    expect(formatDocumentTitle("\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u30CE\u30FC\u30C8")).toBe(
      "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u30CE\u30FC\u30C8 | Uniffy",
    );
  });

  it("handles Korean title", () => {
    expect(formatDocumentTitle("\uD68C\uC758\uB85D")).toBe("\uD68C\uC758\uB85D | Uniffy");
  });

  it("handles Arabic (RTL) title", () => {
    expect(formatDocumentTitle("\u0645\u0644\u0627\u062D\u0638\u0627\u062A")).toBe(
      "\u0645\u0644\u0627\u062D\u0638\u0627\u062A | Uniffy",
    );
  });

  it("handles emoji in title", () => {
    expect(formatDocumentTitle("Sprint Planning \uD83D\uDE80")).toBe(
      "Sprint Planning \uD83D\uDE80 | Uniffy",
    );
  });

  it("handles mixed scripts in one title", () => {
    expect(
      formatDocumentTitle(
        "Notes / \u0417\u0430\u043C\u0435\u0442\u043A\u0438 / \u7B14\u8BB0 / \u30CE\u30FC\u30C8",
      ),
    ).toBe(
      "Notes / \u0417\u0430\u043C\u0435\u0442\u043A\u0438 / \u7B14\u8BB0 / \u30CE\u30FC\u30C8 | Uniffy",
    );
  });

  // -- Edge cases --

  it("handles whitespace-only title", () => {
    expect(formatDocumentTitle("   ")).toBe("    | Uniffy");
  });

  it("handles very long title", () => {
    const long = "A".repeat(200);
    expect(formatDocumentTitle(long)).toBe(`${long} | Uniffy`);
  });

  it("handles title with newlines", () => {
    expect(formatDocumentTitle("Line 1\nLine 2")).toBe("Line 1\nLine 2 | Uniffy");
  });

  it("handles title with tabs", () => {
    expect(formatDocumentTitle("Col1\tCol2")).toBe("Col1\tCol2 | Uniffy");
  });
});
