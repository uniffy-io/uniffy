import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
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

/** Results no widget shows any more are kept for a quick return, up to this many. */
export const MAX_UNMOUNTED_METRICS = 12;

interface MetricEntry {
  status: LoadStatus;
  data?: TaskMetrics;
  args?: FetchMetricArgs;
  /** Widgets on screen showing this result; refresh and invalidation reach only these. */
  mounted: number;
  /** Order the entry lost its last widget in, so the oldest unused result goes first. */
  releasedAt?: number;
}

interface DashboardState {
  catalog: DashboardCatalog | null;
  catalogStatus: LoadStatus;
  saved: SavedDashboard;
  savedStatus: LoadStatus;
  saving: boolean;
  metrics: Record<string, MetricEntry>;
  metricsGeneration: number;
  releaseCounter: number;
}

const initialState: DashboardState = {
  catalog: null,
  catalogStatus: "idle",
  saved: { definition: null, revision: 0, hasPrevious: false },
  savedStatus: "idle",
  saving: false,
  metrics: {},
  metricsGeneration: 0,
  releaseCounter: 0,
};

function pruneUnmounted(state: DashboardState): void {
  const released = Object.entries(state.metrics)
    .filter(([, entry]) => entry.mounted === 0)
    .sort(([, a], [, b]) => (a.releasedAt ?? 0) - (b.releasedAt ?? 0));
  for (const [key] of released.slice(0, Math.max(0, released.length - MAX_UNMOUNTED_METRICS))) {
    delete state.metrics[key];
  }
}

const dashboardSlice = createSlice({
  name: "dashboard",
  initialState,
  reducers: {
    metricMounted(state, action: PayloadAction<string>) {
      const entry = state.metrics[action.payload];
      if (entry) {
        entry.mounted += 1;
        entry.releasedAt = undefined;
      } else {
        state.metrics[action.payload] = { status: "idle", mounted: 1 };
      }
    },
    metricUnmounted(state, action: PayloadAction<string>) {
      const entry = state.metrics[action.payload];
      if (!entry) return;
      entry.mounted = Math.max(0, entry.mounted - 1);
      if (entry.mounted > 0) return;
      state.releaseCounter += 1;
      entry.releasedAt = state.releaseCounter;
      pruneUnmounted(state);
    },
    /** Project access changed: drop every cached result and any answer already on its way. */
    metricsInvalidated(state) {
      state.metricsGeneration += 1;
      for (const [key, entry] of Object.entries(state.metrics)) {
        if (entry.mounted > 0) {
          state.metrics[key] = { status: "idle", args: entry.args, mounted: entry.mounted };
        } else {
          delete state.metrics[key];
        }
      }
    },
  },
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
        const entry = state.metrics[key];
        state.metrics[key] = {
          status: "loading",
          data: entry?.data,
          args: action.meta.arg,
          mounted: entry?.mounted ?? 0,
          releasedAt: entry?.releasedAt,
        };
      })
      .addCase(fetchTaskMetric.fulfilled, (state, action) => {
        const entry = state.metrics[action.meta.arg.key];
        // Started before an access change or after its widget went away: the answer is dropped.
        if (!entry || action.payload.generation !== state.metricsGeneration) return;
        entry.status = "ready";
        entry.data = action.payload.metrics;
        entry.args = action.meta.arg;
      })
      .addCase(fetchTaskMetric.rejected, (state, action) => {
        const entry = state.metrics[action.meta.arg.key];
        if (!entry) return;
        entry.status = "failed";
        entry.args = action.meta.arg;
      });
  },
});

export const dashboardReducer = dashboardSlice.reducer;
export const { metricMounted, metricUnmounted, metricsInvalidated } = dashboardSlice.actions;

export const selectDashboardCatalog = (state: RootState) => state.dashboard.catalog;
export const selectDashboardCatalogStatus = (state: RootState) => state.dashboard.catalogStatus;
export const selectSavedDashboard = (state: RootState) => state.dashboard.saved;
export const selectSavedDashboardStatus = (state: RootState) => state.dashboard.savedStatus;
export const selectDashboardSaving = (state: RootState) => state.dashboard.saving;
export const selectTaskMetric = (key: string) => (state: RootState) =>
  state.dashboard.metrics[key] as MetricEntry | undefined;
