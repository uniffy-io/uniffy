import { describe, expect, it } from "vitest";
import { reconcileTaskSelection } from "@/features/projects/utils/taskNavigation";

describe("task route selection", () => {
  it("waits for route selection before letting stale state rewrite Back navigation", () => {
    const mount = reconcileTaskSelection(null, "org:project:", undefined, "task", true);
    expect(mount.step).toBe("sync");
    const repeated = reconcileTaskSelection(mount.state, "org:project:", undefined, "task", true);
    expect(repeated.step).toBe("wait");
    const settled = reconcileTaskSelection(repeated.state, "org:project:", undefined, null, false);
    expect(settled.step).toBe("ready");
    const clicked = reconcileTaskSelection(settled.state, "org:project:", undefined, "next", true);
    expect(clicked.step).toBe("ready");
  });

  it("accepts clicks after an already matching initial selection", () => {
    const mount = reconcileTaskSelection(null, "org:project:", undefined, null, false);
    expect(reconcileTaskSelection(mount.state, "org:project:", undefined, "task", true).step).toBe(
      "ready",
    );
  });

  it("gives task and organization route changes priority over existing selection", () => {
    const before = { key: "org:project:task", settled: true };
    const next = reconcileTaskSelection(before, "org:project:next", "next", "task", true);
    expect(next.step).toBe("sync");
    expect(reconcileTaskSelection(next.state, "org:project:next", "next", "task", true).step).toBe(
      "wait",
    );
    expect(reconcileTaskSelection(next.state, "org:project:next", "next", "next", true).step).toBe(
      "ready",
    );
    expect(reconcileTaskSelection(before, "other:project:task", "task", "task", true).step).toBe(
      "sync",
    );
  });
});
