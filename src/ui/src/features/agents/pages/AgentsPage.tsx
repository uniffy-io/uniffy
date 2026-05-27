import { useEffect, useLayoutEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { AppHeader } from "@/components/layout/AppHeader";
import { AgentsLayout } from "@/features/agents/components/layout/AgentsLayout";
import {
  setActiveTab,
  setSelectedAgent,
  selectActiveTab,
  type AgentsTab,
} from "@/features/agents/store/agentsUiSlice";

const VALID_TABS: AgentsTab[] = [
  "chat",
  "integrations",
  "conversations",
  "usage",
  "automations",
  "agents",
  "skills",
  "prompts",
  "config",
];

export function AgentsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { tab, subId } = useParams<{ tab?: string; subId?: string }>();
  const persistedTab = useAppSelector(selectActiveTab);

  useDocumentTitle("Agents");

  useLayoutEffect(() => {
    if (!tab) {
      navigate(`/agents/${persistedTab}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time redirect on mount when no tab
  }, []);

  useEffect(() => {
    if (tab && VALID_TABS.includes(tab as AgentsTab)) {
      dispatch(setActiveTab(tab as AgentsTab));
    }
  }, [dispatch, tab]);

  useEffect(() => {
    if (tab === "agents" && subId) {
      dispatch(setSelectedAgent(subId));
    }
  }, [dispatch, tab, subId]);

  return (
    <>
      <AppHeader />
      <div data-testid="agents-page" data-active-tab={tab ?? persistedTab}>
        <AgentsLayout />
      </div>
    </>
  );
}
