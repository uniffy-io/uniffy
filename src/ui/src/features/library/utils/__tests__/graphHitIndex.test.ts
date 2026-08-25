import { describe, expect, it } from "vitest";
import { GraphHitIndex } from "@/features/library/utils/graphHitIndex";

interface TestNode {
  id: string;
  x?: number;
  y?: number;
}

describe("GraphHitIndex", () => {
  it("returns the nearest node across cell boundaries", () => {
    const index = new GraphHitIndex<TestNode>(30);
    const farther = { id: "farther", x: 29, y: 29 };
    const nearest = { id: "nearest", x: 31, y: 31 };
    index.add(farther);
    index.add(nearest);

    expect(index.closest(32, 32, 15)).toBe(nearest);
  });

  it("ignores nodes outside the hit radius and nodes without positions", () => {
    const index = new GraphHitIndex<TestNode>(30);
    index.add({ id: "outside", x: 20, y: 20 });
    index.add({ id: "unpositioned" });

    expect(index.closest(0, 0, 15)).toBeNull();
  });

  it("drops stale frame positions when cleared", () => {
    const index = new GraphHitIndex<TestNode>(30);
    index.add({ id: "stale", x: 5, y: 5 });
    index.clear();

    expect(index.closest(5, 5, 15)).toBeNull();
  });
});
