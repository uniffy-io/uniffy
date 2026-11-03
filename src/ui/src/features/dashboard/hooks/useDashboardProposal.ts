import { useCallback, useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  selectDashboardCatalog,
  selectDashboardCatalogStatus,
  selectDashboardSaving,
  selectSavedDashboard,
} from "@/features/dashboard/store/dashboardSlice";
import {
  fetchDashboard,
  fetchDashboardCatalog,
  restorePreviousDashboard,
  saveDashboard,
} from "@/features/dashboard/store/dashboardThunks";
import type { DashboardProposal } from "@/features/dashboard/utils/layout";

export type ProposalState = "pending" | "applied" | "discarded";

/** Apply or discard an agent's dashboard draft; applying keeps the replaced layout for Undo. */
export function useDashboardProposal(proposal: DashboardProposal) {
  const dispatch = useAppDispatch();
  const catalog = useAppSelector(selectDashboardCatalog);
  const catalogStatus = useAppSelector(selectDashboardCatalogStatus);
  const saving = useAppSelector(selectDashboardSaving);
  const saved = useAppSelector(selectSavedDashboard);
  const orgId = useAppSelector((state) => state.auth.currentOrganizationId);
  const [state, setState] = useState<ProposalState>("pending");
  // What this card's Apply wrote; Undo restores only while that is still the latest version
  // of that organization's dashboard, since revisions count per organization.
  const [applied, setApplied] = useState<{ revision: number; orgId: string } | null>(null);

  useEffect(() => {
    if (catalogStatus === "idle") void dispatch(fetchDashboardCatalog());
  }, [catalogStatus, dispatch]);

  const sameOrganization = !proposal.organizationId || proposal.organizationId === orgId;

  const apply = useCallback(
    async (name: string) => {
      try {
        // The save names the revision it replaces, so read the current one first.
        await dispatch(fetchDashboard()).unwrap();
        const written = await dispatch(
          saveDashboard({ definition: { ...proposal.definition, name }, keepPrevious: true }),
        ).unwrap();
        if (orgId) setApplied({ revision: written.revision, orgId });
        setState("applied");
      } catch {
        // Surfaced by the error toast middleware.
      }
    },
    [dispatch, proposal.definition, orgId],
  );

  // A later save, here or in another tab the last load saw, replaced the restore point.
  const canUndo =
    applied !== null && applied.orgId === orgId && saved.revision === applied.revision;

  const undo = useCallback(async () => {
    if (!canUndo || !applied) return;
    try {
      await dispatch(
        restorePreviousDashboard({
          expectedRevision: applied.revision,
          organizationId: applied.orgId,
        }),
      ).unwrap();
      setApplied(null);
      setState("pending");
    } catch {
      // Surfaced by the error toast middleware; the refetch it triggers turns Undo off.
    }
  }, [dispatch, applied, canUndo]);

  return {
    catalog,
    saving,
    state,
    sameOrganization,
    apply,
    undo,
    canUndo,
    discard: () => setState("discarded"),
  };
}
