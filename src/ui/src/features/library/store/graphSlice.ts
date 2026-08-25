import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { searchApi } from "@/features/search/api/searchApi";

export interface SerializedGraphEdge {
  sourceUrn: string;
  targetUrn: string;
}

interface GraphState {
  organizationId: string | null;
  activeRequestId: string | null;
  edges: SerializedGraphEdge[];
  truncated: boolean;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  fetchedAt: number | null;
}

const initialState: GraphState = {
  organizationId: null,
  activeRequestId: null,
  edges: [],
  truncated: false,
  status: "idle",
  error: null,
  fetchedAt: null,
};

export const fetchContentGraph = createAsyncThunk<
  {
    organizationId: string;
    edges: SerializedGraphEdge[];
    truncated: boolean;
    fetchedAt: number;
  },
  string,
  { state: { libraryGraph: GraphState }; rejectValue: { organizationId: string; message: string } }
>(
  "libraryGraph/fetchContentGraph",
  async (organizationId, { rejectWithValue, signal }) => {
    try {
      const response = await searchApi.getContentGraph({ organizationId }, { signal });
      return {
        organizationId,
        edges: response.edges.map((e) => ({ sourceUrn: e.sourceUrn, targetUrn: e.targetUrn })),
        truncated: response.truncated,
        fetchedAt: Date.now(),
      };
    } catch (error) {
      return rejectWithValue({
        organizationId,
        message: error instanceof Error ? error.message : "Failed to load graph",
      });
    }
  },
  {
    // `focus` and `visibilitychange` both fire on tab return, and each carries the
    // same pre-fetch timestamp. Without this guard both pass the staleness check and
    // run the full org-wide scan, with the first result thrown away.
    condition: (organizationId, { getState }) => {
      const graph = getState().libraryGraph;
      return !(graph.status === "loading" && graph.organizationId === organizationId);
    },
  },
);

const graphSlice = createSlice({
  name: "libraryGraph",
  initialState,
  reducers: {
    clearContentGraph: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchContentGraph.pending, (state, action) => {
        if (state.organizationId !== action.meta.arg) {
          state.edges = [];
          state.truncated = false;
          state.fetchedAt = null;
        }
        state.organizationId = action.meta.arg;
        state.activeRequestId = action.meta.requestId;
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchContentGraph.fulfilled, (state, action) => {
        if (
          state.organizationId !== action.payload.organizationId ||
          state.activeRequestId !== action.meta.requestId
        ) {
          return;
        }
        state.activeRequestId = null;
        state.status = "succeeded";
        state.edges = action.payload.edges;
        state.truncated = action.payload.truncated;
        state.fetchedAt = action.payload.fetchedAt;
      })
      .addCase(fetchContentGraph.rejected, (state, action) => {
        if (
          state.organizationId !== action.meta.arg ||
          state.activeRequestId !== action.meta.requestId
        ) {
          return;
        }
        state.activeRequestId = null;
        state.status = "failed";
        state.error = action.payload?.message ?? "Failed to load graph";
      });
  },
});

export const { clearContentGraph } = graphSlice.actions;
export const libraryGraphReducer = graphSlice.reducer;
