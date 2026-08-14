import { describe, it, expect } from "vitest";
import { TOC_REGEX, parseTocParams, stringifyTocParams } from "@/components/editor/plugins/toc";
import { TOC_DEFAULTS } from "@/components/editor/plugins/toc/tocTypes";
import { headingToSlug, indexedSlug } from "@/components/editor/utils/headingScroll";

// TOC_REGEX

describe("TOC_REGEX", () => {
  it("matches bare directive", () => {
    const m = TOC_REGEX.exec("[[[toc]]]");
    expect(m).not.toBeNull();
    expect(m![1]).toBeUndefined();
  });

  it("matches directive with params", () => {
    const m = TOC_REGEX.exec("[[[toc|min=2|max=4|style=nested|bullets=disc]]]");
    expect(m).not.toBeNull();
    expect(m![1]).toBe("min=2|max=4|style=nested|bullets=disc");
  });

  it("rejects directive embedded in text", () => {
    expect(TOC_REGEX.exec("see [[[toc]]] below")).toBeNull();
  });

  it("rejects unrelated triple-bracket patterns", () => {
    expect(TOC_REGEX.exec("[[[video|/x]]]")).toBeNull();
    expect(TOC_REGEX.exec("[[[Note|urn:uniffy:content:NOTE:1]]]")).toBeNull();
  });

  it("rejects incomplete delimiters", () => {
    expect(TOC_REGEX.exec("[[toc]]")).toBeNull();
    expect(TOC_REGEX.exec("[[[toc]]")).toBeNull();
  });
});

// parseTocParams

describe("parseTocParams", () => {
  it("returns defaults for undefined input", () => {
    expect(parseTocParams(undefined)).toEqual(TOC_DEFAULTS);
  });

  it("parses each known key", () => {
    const out = parseTocParams("min=2|max=5|style=nested|bullets=dash");
    expect(out).toEqual({ min: 2, max: 5, style: "nested", bullets: "dash" });
  });

  it("ignores legacy numbered key", () => {
    const out = parseTocParams("min=1|max=3|numbered=true");
    expect(out).toEqual({ min: 1, max: 3, style: "flat", bullets: "none" });
  });

  it("falls back to default bullets for unknown value", () => {
    expect(parseTocParams("bullets=square").bullets).toBe("none");
  });

  it("clamps out-of-range levels to 1-6", () => {
    const lo = parseTocParams("min=0|max=99");
    expect(lo.min).toBe(1);
    expect(lo.max).toBe(6);
  });

  it("falls back to defaults for unparsable level values", () => {
    const out = parseTocParams("min=abc|max=def");
    expect(out.min).toBe(TOC_DEFAULTS.min);
    expect(out.max).toBe(TOC_DEFAULTS.max);
  });

  it("swaps inverted min/max so consumers always see min<=max", () => {
    const out = parseTocParams("min=5|max=2");
    expect(out.min).toBe(2);
    expect(out.max).toBe(5);
  });

  it("coerces unknown style values to flat", () => {
    expect(parseTocParams("style=tree").style).toBe("flat");
    expect(parseTocParams("style=NESTED").style).toBe("flat");
  });

  it("ignores unknown keys", () => {
    const out = parseTocParams("min=1|foo=bar|max=3");
    expect(out.min).toBe(1);
    expect(out.max).toBe(3);
  });
});

// stringifyTocParams

describe("stringifyTocParams", () => {
  it("emits canonical key order", () => {
    const s = stringifyTocParams({ min: 2, max: 4, style: "nested", bullets: "disc" });
    expect(s).toBe("min=2|max=4|style=nested|bullets=disc");
  });

  it("round-trips against parseTocParams", () => {
    const attrs = { min: 1, max: 6, style: "flat" as const, bullets: "number" as const };
    expect(parseTocParams(stringifyTocParams(attrs))).toEqual(attrs);
  });

  it("regex captures match the canonical stringification", () => {
    const attrs = { min: 2, max: 3, style: "flat" as const, bullets: "dash" as const };
    const md = `[[[toc|${stringifyTocParams(attrs)}]]]`;
    const m = TOC_REGEX.exec(md);
    expect(m).not.toBeNull();
    expect(parseTocParams(m![1])).toEqual(attrs);
  });
});

// headingToSlug + indexedSlug

describe("headingToSlug", () => {
  it("lowercases and replaces non-alphanumerics with hyphens", () => {
    expect(headingToSlug("Access Modes")).toBe("access-modes");
    expect(headingToSlug("Hello, World!")).toBe("hello-world");
  });

  it("strips leading and trailing hyphens", () => {
    expect(headingToSlug("  Trim me  ")).toBe("trim-me");
    expect(headingToSlug("!!Bang!!")).toBe("bang");
  });

  it("collapses runs of non-alphanumerics", () => {
    expect(headingToSlug("foo   bar // baz")).toBe("foo-bar-baz");
  });

  it("returns empty string when text has no alphanumerics", () => {
    expect(headingToSlug("!!!")).toBe("");
  });
});

describe("indexedSlug", () => {
  it("returns base for first occurrence", () => {
    expect(indexedSlug("intro", 0)).toBe("intro");
  });

  it("appends 1-based suffix for repeats", () => {
    expect(indexedSlug("intro", 1)).toBe("intro-2");
    expect(indexedSlug("intro", 2)).toBe("intro-3");
  });
});
