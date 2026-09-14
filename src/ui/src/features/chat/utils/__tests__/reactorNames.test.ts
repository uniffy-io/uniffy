import { describe, it, expect } from "vitest";
import { buildReactorNames } from "@/features/chat/utils/reactorNames";

const NAMES = { "u-1": "Alice Johnson", "u-2": "Bob Smith", "u-3": "Charlie Brown" };

describe("buildReactorNames", () => {
  it("puts the viewer first and drops their id from the list", () => {
    const { names, remaining } = buildReactorNames(
      { count: 3, userIds: ["u-1", "u-2", "u-3"], hasCurrentUser: true },
      NAMES,
      "u-2",
    );
    expect(names).toEqual(["You", "Alice Johnson", "Charlie Brown"]);
    expect(remaining).toBe(0);
  });

  it("keeps server order when the viewer has not reacted", () => {
    const { names } = buildReactorNames(
      { count: 2, userIds: ["u-3", "u-1"], hasCurrentUser: false },
      NAMES,
      "u-2",
    );
    expect(names).toEqual(["Charlie Brown", "Alice Johnson"]);
  });

  it("reports the reactors the bounded list left out", () => {
    const { names, remaining } = buildReactorNames(
      { count: 25, userIds: ["u-1", "u-2"], hasCurrentUser: false },
      NAMES,
      "u-9",
    );
    expect(names).toEqual(["Alice Johnson", "Bob Smith"]);
    expect(remaining).toBe(23);
  });

  it("counts the viewer as named even when they fall outside the bound", () => {
    const { names, remaining } = buildReactorNames(
      { count: 12, userIds: ["u-1", "u-2"], hasCurrentUser: true },
      NAMES,
      "u-9",
    );
    expect(names).toEqual(["You", "Alice Johnson", "Bob Smith"]);
    expect(remaining).toBe(9);
  });

  it("falls back to a short id for a reactor the directory did not resolve", () => {
    const { names } = buildReactorNames(
      { count: 1, userIds: ["019e436f-f97d-72dc-9fe5-27fca9675354"], hasCurrentUser: false },
      NAMES,
      "u-2",
    );
    expect(names).toEqual(["675354"]);
  });

  it("never reports a negative remainder when the count lags the list", () => {
    const { remaining } = buildReactorNames(
      { count: 1, userIds: ["u-1", "u-2"], hasCurrentUser: false },
      NAMES,
      undefined,
    );
    expect(remaining).toBe(0);
  });
});
