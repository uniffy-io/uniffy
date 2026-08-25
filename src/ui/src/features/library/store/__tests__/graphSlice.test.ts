import { describe, expect, it } from "vitest";
import {
  clearContentGraph,
  fetchContentGraph,
  libraryGraphReducer,
  type SerializedGraphEdge,
} from "@/features/library/store/graphSlice";

const edge = (label: string): SerializedGraphEdge => ({
  sourceUrn: `urn:uniffy:content:NOTE:${label}-source`,
  targetUrn: `urn:uniffy:content:NOTE:${label}-target`,
});

describe("libraryGraphReducer", () => {
  it("ignores a response from the organization that was switched away from", () => {
    let state = libraryGraphReducer(
      undefined,
      fetchContentGraph.pending("request-a", "organization-a"),
    );
    state = libraryGraphReducer(state, fetchContentGraph.pending("request-b", "organization-b"));
    state = libraryGraphReducer(
      state,
      fetchContentGraph.fulfilled(
        {
          organizationId: "organization-a",
          edges: [edge("a")],
          truncated: false,
          fetchedAt: 1,
        },
        "request-a",
        "organization-a",
      ),
    );

    expect(state.organizationId).toBe("organization-b");
    expect(state.status).toBe("loading");
    expect(state.edges).toEqual([]);

    state = libraryGraphReducer(
      state,
      fetchContentGraph.fulfilled(
        {
          organizationId: "organization-b",
          edges: [edge("b")],
          truncated: true,
          fetchedAt: 2,
        },
        "request-b",
        "organization-b",
      ),
    );

    expect(state.status).toBe("succeeded");
    expect(state.edges).toEqual([edge("b")]);
    expect(state.truncated).toBe(true);
  });

  it("keeps a cleared graph empty when an invalidated request finishes late", () => {
    let state = libraryGraphReducer(
      undefined,
      fetchContentGraph.pending("request-a", "organization-a"),
    );
    state = libraryGraphReducer(state, clearContentGraph());
    state = libraryGraphReducer(
      state,
      fetchContentGraph.fulfilled(
        {
          organizationId: "organization-a",
          edges: [edge("a")],
          truncated: false,
          fetchedAt: 1,
        },
        "request-a",
        "organization-a",
      ),
    );

    expect(state).toMatchObject({
      organizationId: null,
      activeRequestId: null,
      edges: [],
      status: "idle",
      fetchedAt: null,
    });
  });
});
