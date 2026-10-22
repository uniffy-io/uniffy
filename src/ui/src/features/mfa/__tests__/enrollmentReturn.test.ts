import { describe, expect, it } from "vitest";
import { pathAfterEnrollment } from "@/features/mfa/utils/enrollmentReturn";

describe("pathAfterEnrollment", () => {
  it("returns to the page the sign-in started from", () => {
    expect(pathAfterEnrollment({ from: "/auth/accept-invite?token=abc" })).toBe(
      "/auth/accept-invite?token=abc",
    );
    expect(pathAfterEnrollment({ from: { pathname: "/notes/n1", search: "?view=split" } })).toBe(
      "/notes/n1?view=split",
    );
  });

  it("falls back to home without a return path", () => {
    expect(pathAfterEnrollment({ from: null })).toBe("/");
    expect(pathAfterEnrollment(null)).toBe("/");
    expect(pathAfterEnrollment(undefined)).toBe("/");
  });

  it("falls back to home for a path that would leave the origin", () => {
    expect(pathAfterEnrollment({ from: "https://evil.example/" })).toBe("/");
    expect(pathAfterEnrollment({ from: "//evil.example/path" })).toBe("/");
  });
});
