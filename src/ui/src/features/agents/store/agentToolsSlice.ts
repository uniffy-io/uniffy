import { createSelector, createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { ToolCategorySection, ToolGroup } from "@/features/agents/config/toolCatalog";
import { CATEGORY_SECTIONS } from "@/features/agents/config/toolCatalog";
import type { SerializedTool } from "@/features/agents/store/agentToolsThunks";
import { fetchAgentTools } from "@/features/agents/store/agentToolsThunks";

interface AgentToolsState {
  tools: SerializedTool[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

const initialState: AgentToolsState = {
  tools: [],
  loading: false,
  loaded: false,
  error: null,
};

export const agentToolsSlice = createSlice({
  name: "agentTools",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAgentTools.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAgentTools.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.tools = action.payload;
      })
      .addCase(fetchAgentTools.rejected, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.error = action.payload ?? "Failed to fetch tools";
      });
  },
});

export const selectAgentTools = (state: RootState) => state.agentTools.tools;
export const selectAgentToolsLoading = (state: RootState) => state.agentTools.loading;
export const selectAgentToolsLoaded = (state: RootState) => state.agentTools.loaded;

/**
 * Sections for the builder, rebuilt from the server's order: it already sorts
 * by category, then group, then registration order, so grouping by first
 * appearance preserves it. Section labels are the only local copy - they name
 * the surface, not the tools.
 */
export const selectToolSections = createSelector(
  [selectAgentTools],
  (tools): ToolCategorySection[] => {
    const byCategory = new Map<string, Map<string, ToolGroup>>();

    for (const tool of tools) {
      const groups = byCategory.get(tool.category) ?? new Map<string, ToolGroup>();
      byCategory.set(tool.category, groups);

      const group = groups.get(tool.group) ?? {
        group: tool.group,
        tools: [],
        ...(tool.requiresConnection ? { requiresConnection: tool.requiresConnection } : {}),
      };
      group.tools.push({
        name: tool.name,
        displayName: tool.displayName,
        description: tool.description,
        destructive: tool.destructive,
      });
      groups.set(tool.group, group);
    }

    return [...byCategory.entries()].map(([category, groups]) => ({
      category,
      label: CATEGORY_SECTIONS[category]?.label ?? category,
      description: CATEGORY_SECTIONS[category]?.description ?? "",
      groups: [...groups.values()],
    }));
  },
);

export const selectToolsByName = createSelector(
  [selectAgentTools],
  (tools) => new Map(tools.map((tool) => [tool.name, tool])),
);

/** Group names in render order, which is also the order the color ramp walks. */
export const selectToolGroupOrder = createSelector([selectToolSections], (sections) =>
  sections.flatMap((section) => section.groups.map((group) => group.group)),
);

export const agentToolsReducer = agentToolsSlice.reducer;
