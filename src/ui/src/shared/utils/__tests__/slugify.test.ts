import { describe, it, expect } from "vitest";
import { slugify } from "../slugify";

describe("slugify", () => {
  it("lowercases the input", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("foo bar baz")).toBe("foo-bar-baz");
  });

  it("collapses multiple spaces into a single hyphen", () => {
    expect(slugify("foo   bar")).toBe("foo-bar");
  });

  it("collapses multiple hyphens into one", () => {
    expect(slugify("foo---bar")).toBe("foo-bar");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("hello!@#world")).toBe("helloworld");
  });

  it("preserves numbers", () => {
    expect(slugify("version 2 release")).toBe("version-2-release");
  });

  it("preserves existing hyphens", () => {
    expect(slugify("already-slugged")).toBe("already-slugged");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("-hello-")).toBe("hello");
    expect(slugify("---hello---")).toBe("hello");
  });

  it("handles mixed special characters and spaces", () => {
    expect(slugify("  Design & Feedback!  ")).toBe("design-feedback");
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });

  it("returns empty string for only special characters", () => {
    expect(slugify("!@#$%^&*()")).toBe("");
  });

  it("handles tabs and newlines as whitespace", () => {
    expect(slugify("foo\tbar\nbaz")).toBe("foo-bar-baz");
  });

  it("handles a realistic channel name", () => {
    expect(slugify("Design Feedback")).toBe("design-feedback");
  });

  it("handles input that is already a valid slug", () => {
    expect(slugify("design-feedback")).toBe("design-feedback");
  });
});
