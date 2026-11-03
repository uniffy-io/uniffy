import { useCallback } from "react";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useAppDispatch } from "@/app/hooks";
import { metricsInvalidated } from "@/features/dashboard/store/dashboardSlice";
import { refreshTaskMetrics } from "@/features/dashboard/store/dashboardThunks";
import type { ContentAccessChange } from "@/features/notifications/contentAccessEmitter";
import { useContentAccessRefetch } from "@/features/notifications/hooks/useContentAccessRefetch";

const NARROWING: ReadonlySet<ContentAccessChange["action"]> = new Set([
  "revoked",
  "access_mode_changed",
]);

/**
 * Any metric may count a project whose access just changed, so a loss clears every cached result
 * before the widgets on screen reload; a new grant only reloads them.
 */
export function useMetricAccessInvalidation(): void {
  const dispatch = useAppDispatch();
  useContentAccessRefetch(
    ContentType.PROJECT,
    useCallback(
      (changes: readonly ContentAccessChange[]) => {
        if (changes.every((change) => change.action === "views_changed")) return;
        if (changes.some((change) => NARROWING.has(change.action))) dispatch(metricsInvalidated());
        void dispatch(refreshTaskMetrics());
      },
      [dispatch],
    ),
  );
}
