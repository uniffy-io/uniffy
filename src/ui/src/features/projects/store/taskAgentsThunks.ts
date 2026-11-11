import { createAsyncThunk } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "@/app/store";
import { agentsApi } from "@/features/agents/api/agentsApi";
import { projectsApi } from "@/features/projects/api/projectsApi";
import { fetchActivities } from "@/features/projects/store/projectsThunks";
import type { AgentRunStart, Project, Task } from "@/features/projects/types/project";
import { fetchAllPages } from "@/shared/utils/fetchAllPages";

/** An agent the signed-in member can hand a task to. */
export interface AssignableAgent {
  id: string;
  name: string;
  avatarEmoji: string | null;
}

const AGENT_PAGE_SIZE = 100;
/** Agents and the policy change rarely; a picker opened later than this refetches them. */
export const TASK_AGENTS_STALE_MS = 5 * 60 * 1000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const fetchAgentAssignmentPolicy = createAsyncThunk<
  { organizationId: string; enabled: boolean },
  void,
  { state: RootState; rejectValue: string }
>(
  "taskAgents/fetchPolicy",
  async (_, { getState, rejectWithValue }) => {
    const organizationId = getState().auth.currentOrganizationId;
    if (!organizationId) return rejectWithValue("No organization selected");
    try {
      const enabled = await projectsApi.getAgentAssignmentPolicy(organizationId);
      return { organizationId, enabled };
    } catch (error) {
      return rejectWithValue(errorText(error));
    }
  },
  {
    condition: (_, { getState }) => {
      const { policy } = getState().taskAgents;
      const organizationId = getState().auth.currentOrganizationId;
      return !policy.loading && !isFresh(policy.loadedFor, policy.loadedAt, organizationId);
    },
  },
);

export const fetchAssignableAgents = createAsyncThunk<
  { organizationId: string; agents: AssignableAgent[] },
  void,
  { state: RootState; rejectValue: string }
>(
  "taskAgents/fetchAgents",
  async (_, { getState, rejectWithValue }) => {
    const organizationId = getState().auth.currentOrganizationId;
    if (!organizationId) return rejectWithValue("No organization selected");
    try {
      const agents = await fetchAllPages(
        async (page) => {
          const response = await agentsApi.listAgents({
            organizationId,
            pagination: { page, pageSize: AGENT_PAGE_SIZE },
          });
          return { items: response.agents, totalPages: response.pagination?.totalPages ?? 1 };
        },
        { key: (agent) => agent.id },
      );
      return {
        organizationId,
        agents: agents
          .map((agent) => ({
            id: agent.id,
            name: agent.name,
            avatarEmoji: agent.avatarEmoji || null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    } catch (error) {
      return rejectWithValue(errorText(error));
    }
  },
  {
    condition: (_, { getState }) => {
      const { list } = getState().taskAgents;
      const organizationId = getState().auth.currentOrganizationId;
      return !list.loading && !isFresh(list.loadedFor, list.loadedAt, organizationId);
    },
  },
);

/** The agents and policy every agent picker reads; each refetches only once stale. */
export const fetchTaskAgents = () => (dispatch: AppDispatch) => {
  void dispatch(fetchAgentAssignmentPolicy());
  void dispatch(fetchAssignableAgents());
};

function isFresh(
  loadedFor: string | null,
  loadedAt: number,
  organizationId: string | null,
): boolean {
  return loadedFor === organizationId && Date.now() - loadedAt < TASK_AGENTS_STALE_MS;
}

export const assignTaskAgent = createAsyncThunk<
  Task,
  { taskId: string; agentId: string | null; start?: AgentRunStart },
  { dispatch: AppDispatch; rejectValue: string }
>(
  "taskAgents/assignTask",
  async ({ taskId, agentId, start }, { getState, dispatch, rejectWithValue }) => {
    const organizationId = (getState() as RootState).auth.currentOrganizationId;
    if (!organizationId) return rejectWithValue("No organization selected");
    try {
      const { task } = await projectsApi.assignTaskAgent(taskId, agentId, organizationId, start);
      dispatch(fetchActivities(taskId));
      return task;
    } catch (error) {
      return rejectWithValue(errorText(error));
    }
  },
);

export const startTaskAgent = createAsyncThunk<
  Task,
  string,
  { state: RootState; rejectValue: string }
>("taskAgents/startTask", async (taskId, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) return rejectWithValue("No organization selected");
  try {
    return await projectsApi.startTaskAgent(taskId, organizationId);
  } catch (error) {
    return rejectWithValue(errorText(error));
  }
});

export const stopTaskAgent = createAsyncThunk<
  Task,
  string,
  { state: RootState; rejectValue: string }
>("taskAgents/stopTask", async (taskId, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) return rejectWithValue("No organization selected");
  try {
    return await projectsApi.stopTaskAgent(taskId, organizationId);
  } catch (error) {
    return rejectWithValue(errorText(error));
  }
});

export const requestTaskAgentChanges = createAsyncThunk<
  Task,
  { taskId: string; changes: string },
  { state: RootState; rejectValue: string }
>("taskAgents/requestChanges", async ({ taskId, changes }, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) return rejectWithValue("No organization selected");
  try {
    return await projectsApi.requestTaskAgentChanges(taskId, changes, organizationId);
  } catch (error) {
    return rejectWithValue(errorText(error));
  }
});

export const setProjectAgentAssignee = createAsyncThunk<
  Project,
  { projectId: string; agentId: string | null },
  { rejectValue: string }
>("taskAgents/setProjectAgent", async ({ projectId, agentId }, { getState, rejectWithValue }) => {
  const organizationId = (getState() as RootState).auth.currentOrganizationId;
  if (!organizationId) return rejectWithValue("No organization selected");
  try {
    return await projectsApi.setProjectAgentAssignee(projectId, agentId, organizationId);
  } catch (error) {
    return rejectWithValue(errorText(error));
  }
});

export const updateAgentAssignmentPolicy = createAsyncThunk<
  boolean,
  boolean,
  { state: RootState; rejectValue: string }
>("taskAgents/updatePolicy", async (enabled, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) return rejectWithValue("No organization selected");
  try {
    return await projectsApi.updateAgentAssignmentPolicy(enabled, organizationId);
  } catch (error) {
    return rejectWithValue(errorText(error));
  }
});
