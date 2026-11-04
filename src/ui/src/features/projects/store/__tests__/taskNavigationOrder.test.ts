import { describe, expect, it } from "vitest";
import {
  projectsUiReducer,
  setTaskNavigationOrder,
} from "@/features/projects/store/projectsUiSlice";
import { initialProjectsUiState } from "@/features/projects/types/ui";

describe("setTaskNavigationOrder", () => {
  it("stores the order a view shows", () => {
    const state = projectsUiReducer(initialProjectsUiState, setTaskNavigationOrder(["a", "b"]));
    expect(state.taskNavigationOrder).toEqual(["a", "b"]);
  });

  it("keeps the same state when the order did not change, so nothing re-renders", () => {
    const first = projectsUiReducer(initialProjectsUiState, setTaskNavigationOrder(["a", "b"]));
    const second = projectsUiReducer(first, setTaskNavigationOrder(["a", "b"]));
    expect(second).toBe(first);
  });

  it("replaces the order when it changes", () => {
    const first = projectsUiReducer(initialProjectsUiState, setTaskNavigationOrder(["a", "b"]));
    expect(
      projectsUiReducer(first, setTaskNavigationOrder(["b", "a"])).taskNavigationOrder,
    ).toEqual(["b", "a"]);
  });
});
