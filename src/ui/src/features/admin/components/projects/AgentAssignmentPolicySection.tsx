import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { PolicyRow } from "@/features/admin/components/projects/PolicyRow";
import {
  fetchAgentAssignmentPolicy,
  updateAgentAssignmentPolicy,
} from "@/features/projects/store/taskAgentsThunks";

/** The organization's switch for handing tasks and projects to agents. */
export function AgentAssignmentPolicySection() {
  const dispatch = useAppDispatch();
  const enabled = useAppSelector((state) => state.taskAgents.policy.enabled);
  const loaded = useAppSelector(
    (state) => state.taskAgents.policy.loadedFor === state.auth.currentOrganizationId,
  );

  useEffect(() => {
    void dispatch(fetchAgentAssignmentPolicy());
  }, [dispatch]);

  return (
    <div className="mx-auto mt-6 w-full max-w-3xl">
      <div className="rounded-xl bg-surface shadow-edge" data-testid="agent-assignment-policy">
        <PolicyRow
          title="Assign tasks to agents"
          description="Members can hand a task to an agent they can use, and project admins can choose an agent that picks up new tasks. The agent works with the permissions of the person it works for and leaves deletes and schedules to them. Turning this off stops new and running runs."
        >
          <ToggleSwitch
            enabled={enabled}
            onChange={(value) => void dispatch(updateAgentAssignmentPolicy(value))}
            disabled={!loaded}
            ariaLabel="Assign tasks to agents"
          />
        </PolicyRow>
      </div>
    </div>
  );
}
