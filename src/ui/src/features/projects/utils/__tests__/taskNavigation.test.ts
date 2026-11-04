import { describe, expect, it } from "vitest";
import { neighbours, readTaskPageState } from "@/features/projects/utils/taskNavigation";

describe("neighbours", () => {
  it("finds the tasks around one in the middle", () => {
    expect(neighbours(["a", "b", "c"], "b")).toEqual({ prev: "a", next: "c" });
  });

  it("stops at either end", () => {
    expect(neighbours(["a", "b"], "a")).toEqual({ prev: null, next: "b" });
    expect(neighbours(["a", "b"], "b")).toEqual({ prev: "a", next: null });
  });

  it("has nothing to walk without the list or when the task left it", () => {
    expect(neighbours(undefined, "a")).toEqual({ prev: null, next: null });
    expect(neighbours(["x"], "a")).toEqual({ prev: null, next: null });
  });
});

describe("readTaskPageState", () => {
  it("keeps a well-formed order and an in-app return path", () => {
    expect(readTaskPageState({ order: ["a", "b"], from: "/projects/p?view=v" })).toEqual({
      order: ["a", "b"],
      from: "/projects/p?view=v",
    });
  });

  it("drops malformed values and outside addresses", () => {
    expect(readTaskPageState({ order: ["a", 2], from: "https://example.com" })).toEqual({
      order: undefined,
      from: undefined,
    });
    expect(readTaskPageState({ from: "//example.com/x" }).from).toBeUndefined();
    expect(readTaskPageState({ from: "/\\example.com/x" }).from).toBeUndefined();
    expect(readTaskPageState({ from: "/\t/example.com/x" }).from).toBeUndefined();
    expect(readTaskPageState({ from: "/\n/example.com/x" }).from).toBeUndefined();
    expect(readTaskPageState(null)).toEqual({});
  });
});
