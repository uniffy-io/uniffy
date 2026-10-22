import { describe, expect, it } from "vitest";
import { returnPathFrom } from "@/features/auth/utils/returnPath";

describe("returnPathFrom", () => {
  it("reads a path string", () => {
    expect(returnPathFrom({ from: "/auth/accept-invite?token=abc" })).toBe(
      "/auth/accept-invite?token=abc",
    );
  });

  it("reads a Location with its search and hash", () => {
    expect(
      returnPathFrom({ from: { pathname: "/notes/n1", search: "?view=split", hash: "#h2" } }),
    ).toBe("/notes/n1?view=split#h2");
    expect(returnPathFrom({ from: { pathname: "/files" } })).toBe("/files");
  });

  it("ignores state without a usable path", () => {
    expect(returnPathFrom(null)).toBeNull();
    expect(returnPathFrom(undefined)).toBeNull();
    expect(returnPathFrom({})).toBeNull();
    expect(returnPathFrom({ from: 42 })).toBeNull();
    expect(returnPathFrom({ from: { search: "?a=1" } })).toBeNull();
    expect(returnPathFrom({ from: "" })).toBeNull();
  });

  it("drops anything that would leave the origin", () => {
    expect(returnPathFrom({ from: "https://evil.example/" })).toBeNull();
    expect(returnPathFrom({ from: "//evil.example/path" })).toBeNull();
    expect(returnPathFrom({ from: "/\\evil.example/path" })).toBeNull();
    expect(returnPathFrom({ from: "/\t/evil.example" })).toBeNull();
    expect(returnPathFrom({ from: "javascript:alert(1)" })).toBeNull();
    expect(returnPathFrom({ from: { pathname: "//evil.example" } })).toBeNull();
  });
});
