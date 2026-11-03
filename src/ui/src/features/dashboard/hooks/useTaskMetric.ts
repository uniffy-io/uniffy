import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  metricMounted,
  metricUnmounted,
  selectTaskMetric,
} from "@/features/dashboard/store/dashboardSlice";
import { fetchTaskMetric } from "@/features/dashboard/store/dashboardThunks";
import type { TaskMetricKind, WidgetFilters } from "@/features/dashboard/types";
import { metricKey } from "@/features/dashboard/utils/layout";

/** Loads one widget's server-side aggregate; widgets with equal filters share the entry. */
export function useTaskMetric(
  widgetId: string,
  metric: TaskMetricKind,
  filters: WidgetFilters,
  limit?: number,
) {
  const dispatch = useAppDispatch();
  const orgId = useAppSelector((state) => state.auth.currentOrganizationId);
  const key = useMemo(
    () => `${metricKey(widgetId, filters)}|${limit ?? ""}`,
    [widgetId, filters, limit],
  );
  const entry = useAppSelector(selectTaskMetric(key));

  useEffect(() => {
    dispatch(metricMounted(key));
    return () => {
      dispatch(metricUnmounted(key));
    };
  }, [key, dispatch]);

  useEffect(() => {
    if (!orgId) return;
    void dispatch(fetchTaskMetric({ key, metric, filters, limit }));
    // `key` captures every input that changes the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, orgId, dispatch]);

  return {
    data: entry?.data,
    loading: !entry || ((entry.status === "loading" || entry.status === "idle") && !entry.data),
    failed: entry?.status === "failed" && !entry.data,
  };
}
