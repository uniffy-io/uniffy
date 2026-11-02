import { useCallback, useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  selectDashboardCatalog,
  selectDashboardSaving,
} from "@/features/dashboard/store/dashboardSlice";
import {
  fetchDashboard,
  fetchDashboardCatalog,
  restorePreviousDashboard,
  saveDashboard,
} from "@/features/dashboard/store/dashboardThunks";
import type { DashboardProposal } from "@/features/dashboard/utils/layout";
import { fetchProjects } from "@/features/projects/store/projectsThunks";

export type ProposalState = "pending" | "applied" | "discarded";

/** Apply or discard an agent's dashboard draft; applying keeps the replaced layout for Undo. */
export function useDashboardProposal(proposal: DashboardProposal) {
  const dispatch = useAppDispatch();
  const catalog = useAppSelector(selectDashboardCatalog);
  const saving = useAppSelector(selectDashboardSaving);
  const orgId = useAppSelector((state) => state.auth.currentOrganizationId);
  const [state, setState] = useState<ProposalState>("pending");
  const knownProjects = useAppSelector((s) => s.projects.projects);
  const namesProjects = proposal.definition.widgets.some((widget) =>
    widget.filters.projectIds.some((id) => !knownProjects[id]),
  );

  useEffect(() => {
    if (!catalog) void dispatch(fetchDashboardCatalog());
    // The preview names selected projects; outside Projects the list may not be loaded yet.
    if (namesProjects) void dispatch(fetchProjects());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sameOrganization = !proposal.organizationId || proposal.organizationId === orgId;

  const apply = useCallback(
    async (name: string) => {
      try {
        // The save names the revision it replaces, so read the current one first.
        await dispatch(fetchDashboard()).unwrap();
        await dispatch(
          saveDashboard({ definition: { ...proposal.definition, name }, keepPrevious: true }),
        ).unwrap();
        setState("applied");
      } catch {
        // Surfaced by the error toast middleware.
      }
    },
    [dispatch, proposal.definition],
  );

  const undo = useCallback(async () => {
    try {
      await dispatch(fetchDashboard()).unwrap();
      await dispatch(restorePreviousDashboard()).unwrap();
      setState("pending");
    } catch {
      // Surfaced by the error toast middleware.
    }
  }, [dispatch]);

  return {
    catalog,
    saving,
    state,
    sameOrganization,
    apply,
    undo,
    discard: () => setState("discarded"),
  };
}
