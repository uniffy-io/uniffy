import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import {
  type FetchMetricArgs,
  fetchDashboard,
  fetchDashboardCatalog,
  fetchTaskMetric,
  restorePreviousDashboard,
  saveDashboard,
} from "@/features/dashboard/store/dashboardThunks";
import type { DashboardCatalog, SavedDashboard, TaskMetrics } from "@/features/dashboard/types";

type LoadStatus = "idle" | "loading" | "ready" | "failed";

interface MetricEntry {
  status: LoadStatus;
  data?: TaskMetrics;
  args?: FetchMetricArgs;
}

interface DashboardState {
  catalog: DashboardCatalog | null;
  catalogStatus: LoadStatus;
  saved: SavedDashboard;
  savedStatus: LoadStatus;
  saving: boolean;
  metrics: Record<string, MetricEntry>;
}

const initialState: DashboardState = {
  catalog: null,
  catalogStatus: "idle",
  saved: { definition: null, revision: 0, hasPrevious: false },
  savedStatus: "idle",
  saving: false,
  metrics: {},
};

const dashboardSlice = createSlice({
  name: "dashboard",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchDashboardCatalog.pending, (state) => {
        state.catalogStatus = "loading";
      })
      .addCase(fetchDashboardCatalog.fulfilled, (state, action) => {
        state.catalog = action.payload;
        state.catalogStatus = "ready";
      })
      .addCase(fetchDashboardCatalog.rejected, (state) => {
        state.catalogStatus = "failed";
      })
      .addCase(fetchDashboard.pending, (state) => {
        if (state.savedStatus === "idle") state.savedStatus = "loading";
      })
      .addCase(fetchDashboard.fulfilled, (state, action) => {
        state.saved = action.payload;
        state.savedStatus = "ready";
      })
      .addCase(fetchDashboard.rejected, (state) => {
        state.savedStatus = "failed";
      });

    for (const thunk of [saveDashboard, restorePreviousDashboard]) {
      builder
        .addCase(thunk.pending, (state) => {
          state.saving = true;
        })
        .addCase(thunk.fulfilled, (state, action) => {
          state.saved = action.payload;
          state.saving = false;
        })
        .addCase(thunk.rejected, (state) => {
          state.saving = false;
        });
    }

    builder
      .addCase(fetchTaskMetric.pending, (state, action) => {
        const key = action.meta.arg.key;
        state.metrics[key] = {
          status: "loading",
          data: state.metrics[key]?.data,
          args: action.meta.arg,
        };
      })
      .addCase(fetchTaskMetric.fulfilled, (state, action) => {
        state.metrics[action.meta.arg.key] = {
          status: "ready",
          data: action.payload,
          args: action.meta.arg,
        };
      })
      .addCase(fetchTaskMetric.rejected, (state, action) => {
        const key = action.meta.arg.key;
        state.metrics[key] = {
          status: "failed",
          data: state.metrics[key]?.data,
          args: action.meta.arg,
        };
      });
  },
});

export const dashboardReducer = dashboardSlice.reducer;

export const selectDashboardCatalog = (state: RootState) => state.dashboard.catalog;
export const selectSavedDashboard = (state: RootState) => state.dashboard.saved;
export const selectSavedDashboardStatus = (state: RootState) => state.dashboard.savedStatus;
export const selectDashboardSaving = (state: RootState) => state.dashboard.saving;
export const selectTaskMetric = (key: string) => (state: RootState) =>
  state.dashboard.metrics[key] as MetricEntry | undefined;
