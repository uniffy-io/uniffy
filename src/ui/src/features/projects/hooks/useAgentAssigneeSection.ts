import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SUBJECT_TYPE, type SubjectPickerSection } from "@/components/subject";
import { fetchTaskAgents } from "@/features/projects/store/taskAgentsThunks";

interface AgentAssigneeSectionArgs {
  currentAgentId: string | null;
  /** The picked agent, or null when the current one was picked again to take the task back. */
  onSelect: (agentId: string | null) => void;
  enabled?: boolean;
}

/** The "Agents" section of an assignee picker; empty when the organization turned it off. */
export function useAgentAssigneeSection({
  currentAgentId,
  onSelect,
  enabled = true,
}: AgentAssigneeSectionArgs): SubjectPickerSection[] {
  const dispatch = useAppDispatch();
  const agents = useAppSelector((state) => state.taskAgents.list.agents);
  const assignmentEnabled = useAppSelector((state) => state.taskAgents.policy.enabled);

  useEffect(() => {
    if (enabled) dispatch(fetchTaskAgents());
  }, [dispatch, enabled]);

  return useMemo(() => {
    if (!enabled || !assignmentEnabled || agents.length === 0) return [];
    return [
      {
        id: "agents",
        label: "Agents",
        rows: agents.map((agent) => ({
          id: agent.id,
          subject: {
            id: agent.id,
            type: SUBJECT_TYPE.AGENT,
            name: agent.name,
            avatarEmoji: agent.avatarEmoji ?? undefined,
          },
          badge: "Agent",
          selected: agent.id === currentAgentId,
          onToggle: () => onSelect(agent.id === currentAgentId ? null : agent.id),
        })),
      },
    ];
  }, [enabled, assignmentEnabled, agents, currentAgentId, onSelect]);
}
