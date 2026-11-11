import React, { useMemo } from "react";
import { Avatar } from "@shared/components/Avatar";
import type { PickerSection } from "@shared/directory/pickerRows";
import { useAgents } from "@features/agents/useAgents";
import { useAgentAssignmentPolicy } from "@features/projects/useProjects";

/** The "Agents" section of an assignee sheet; empty when the organization turned it off. */
export function useAgentAssigneeSection({
  currentAgentId,
  onSelect,
  enabled,
}: {
  /** Off until the sheet opens, so browsing tasks does not fetch the agent list. */
  enabled: boolean;
  currentAgentId: string | undefined;
  /** The picked agent, or null when the current one was picked again to take the task back. */
  onSelect: (agentId: string | null, agentName: string) => void;
}): PickerSection[] {
  const agentsQuery = useAgents({ enabled });
  const policyQuery = useAgentAssignmentPolicy(enabled);
  const agents = agentsQuery.data;
  const allowed = policyQuery.data ?? true;

  return useMemo(() => {
    // ListAgents serves live agents the member can use, so the list needs no further filter.
    const live = agents ?? [];
    if (!enabled || !allowed || live.length === 0) return [];
    return [
      {
        id: "agents",
        title: "Agents",
        rows: live.map((agent) => ({
          id: agent.id,
          label: agent.name,
          subtitle: "Agent",
          leading: (
            <Avatar name={agent.name} emoji={agent.avatarEmoji || undefined} isAgent size={32} />
          ),
          selected: agent.id === currentAgentId,
          onPress: () => onSelect(agent.id === currentAgentId ? null : agent.id, agent.name),
        })),
      },
    ];
  }, [agents, enabled, allowed, currentAgentId, onSelect]);
}
