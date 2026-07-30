import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { AppHeader } from "@/components/layout/AppHeader";
import { AgentsLayout } from "@/features/agents/components/layout/AgentsLayout";
import {
  AGENT_PANELS,
  AGENTS_SECTIONS,
  setLastSection,
  selectLastSection,
  type AgentPanel,
  type AgentsSection,
} from "@/features/agents/store/agentsUiSlice";

const PANEL_ALIASES: Record<string, AgentPanel> = {
  memories: "memory",
  tools: "capabilities",
  skills: "capabilities",
};

export function AgentsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { tab, subId, panel } = useParams<{ tab?: string; subId?: string; panel?: string }>();
  const lastSection = useAppSelector(selectLastSection);

  useDocumentTitle("Agents");

  useEffect(() => {
    if (!tab) {
      navigate(`/agents/${lastSection}`, { replace: true });
      return;
    }
    // Agent conversations live in chat DMs; old /agents/chat links land there.
    if (tab === "chat") {
      navigate("/chat", { replace: true });
      return;
    }
    if (!AGENTS_SECTIONS.includes(tab as AgentsSection)) {
      navigate("/agents/agents", { replace: true });
      return;
    }
    if (tab === "agents" && subId) {
      const resolved = panel ? (PANEL_ALIASES[panel] ?? panel) : undefined;
      if (!resolved || !AGENT_PANELS.includes(resolved as AgentPanel)) {
        navigate(`/agents/agents/${subId}/overview`, { replace: true });
        return;
      }
      if (resolved !== panel) {
        navigate(`/agents/agents/${subId}/${resolved}`, { replace: true });
        return;
      }
    }
    dispatch(setLastSection(tab as AgentsSection));
  }, [dispatch, navigate, tab, subId, panel, lastSection]);

  return (
    <>
      <AppHeader />
      <div data-testid="agents-page" data-active-tab={tab ?? lastSection}>
        <AgentsLayout />
      </div>
    </>
  );
}
