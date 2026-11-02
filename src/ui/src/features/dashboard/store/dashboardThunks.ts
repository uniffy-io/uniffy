import { createAsyncThunk } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import { dashboardApi } from "@/features/dashboard/api/dashboardApi";
import type {
  DashboardCatalog,
  DashboardDefinition,
  SavedDashboard,
  TaskMetricKind,
  TaskMetrics,
  WidgetFilters,
} from "@/features/dashboard/types";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";

type ThunkConfig = { state: RootState; rejectValue: string };

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const fetchDashboardCatalog = createAsyncThunk<DashboardCatalog, void, ThunkConfig>(
  "dashboard/fetchCatalog",
  async (_, { rejectWithValue }) => {
    try {
      return await dashboardApi.getCatalog();
    } catch (error) {
      return rejectWithValue(message(error, "Failed to load dashboard widgets"));
    }
  },
);

export const fetchDashboard = createAsyncThunk<SavedDashboard, void, ThunkConfig>(
  "dashboard/fetch",
  async (_, { getState, rejectWithValue }) => {
    const orgId = getState().auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await dashboardApi.getDashboard(orgId);
    } catch (error) {
      return rejectWithValue(message(error, "Failed to load dashboard"));
    }
  },
);

export interface SaveDashboardArgs {
  definition: DashboardDefinition;
  /** Keep the replaced layout so Restore can bring it back (presets, agent proposals). */
  keepPrevious?: boolean;
}

export const saveDashboard = createAsyncThunk<SavedDashboard, SaveDashboardArgs, ThunkConfig>(
  "dashboard/save",
  async ({ definition, keepPrevious = false }, { getState, dispatch, rejectWithValue }) => {
    const state = getState();
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await dashboardApi.saveDashboard(
        orgId,
        definition,
        state.dashboard.saved.revision,
        keepPrevious,
      );
    } catch (error) {
      // Another tab saved first: load its layout so the next edit starts from it.
      void dispatch(fetchDashboard());
      return rejectWithValue(message(error, "Failed to save dashboard"));
    }
  },
);

export const restorePreviousDashboard = createAsyncThunk<SavedDashboard, void, ThunkConfig>(
  "dashboard/restorePrevious",
  async (_, { getState, dispatch, rejectWithValue }) => {
    const state = getState();
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await dashboardApi.restorePrevious(orgId, state.dashboard.saved.revision);
    } catch (error) {
      void dispatch(fetchDashboard());
      return rejectWithValue(message(error, "Failed to restore the dashboard"));
    }
  },
);

export interface FetchMetricArgs {
  /** Cache key: one widget's metric under its filters. */
  key: string;
  metric: TaskMetricKind;
  filters: WidgetFilters;
  limit?: number;
}

export const fetchTaskMetric = createAsyncThunk<TaskMetrics, FetchMetricArgs, ThunkConfig>(
  "dashboard/fetchTaskMetric",
  async ({ metric, filters, limit }, { getState, rejectWithValue }) => {
    const orgId = getState().auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");
    try {
      return await dashboardApi.getTaskMetrics(
        orgId,
        metric,
        filters,
        getEffectiveTimeZone(),
        limit,
      );
    } catch (error) {
      return rejectWithValue(message(error, "Failed to load the widget"));
    }
  },
);

/** Re-runs every metric a widget on screen asked for, under the same filters. */
export const refreshTaskMetrics = createAsyncThunk<void, void, ThunkConfig>(
  "dashboard/refreshTaskMetrics",
  async (_, { getState, dispatch }) => {
    for (const entry of Object.values(getState().dashboard.metrics)) {
      if (entry.args) void dispatch(fetchTaskMetric(entry.args));
    }
  },
);
