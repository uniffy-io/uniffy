import { createAsyncThunk } from "@reduxjs/toolkit";
import { skillsApi } from "@/features/agents/api/skillsApi";
import { skillToPlain } from "@/features/agents/store/agentSkillsThunks";
import type { RootState } from "@/app/store";
import type { SkillDraft } from "@uniffy/proto/agents/v1/skills_pb";

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) throw new Error("No organization selected");
  return orgId;
};

const timestampToPlain = (ts?: { seconds: bigint | number; nanos: bigint | number }) => {
  if (!ts) return undefined;
  return {
    seconds: typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds,
    nanos: typeof ts.nanos === "bigint" ? Number(ts.nanos) : ts.nanos,
  };
};

export const skillDraftToPlain = (draft: SkillDraft) => ({
  id: draft.id,
  organizationId: draft.organizationId,
  ownerId: draft.ownerId,
  targetSkillId: draft.targetSkillId ?? undefined,
  kind: draft.kind,
  proposedByAgentId: draft.proposedByAgentId ?? undefined,
  sessionId: draft.sessionId ?? undefined,
  channelId: draft.channelId ?? undefined,
  originChatMessageId: draft.originChatMessageId ?? undefined,
  rationale: draft.rationale,
  name: draft.name,
  displayName: draft.displayName,
  description: draft.description,
  content: draft.content,
  whenToUse: draft.whenToUse,
  requiresTools: [...draft.requiresTools],
  requiresContext: [...draft.requiresContext],
  suggestedAlwaysActive: draft.suggestedAlwaysActive,
  status: draft.status,
  createdAt: timestampToPlain(draft.createdAt),
  updatedAt: timestampToPlain(draft.updatedAt),
});

export type SerializedSkillDraft = ReturnType<typeof skillDraftToPlain>;

export interface SaveDraftFields {
  name: string;
  displayName: string;
  description: string;
  content: string;
  whenToUse: string;
  requiresTools: string[];
  requiresContext: string[];
  suggestedAlwaysActive: boolean;
  changeSummary?: string;
}

export const fetchSkillDrafts = createAsyncThunk<
  SerializedSkillDraft[],
  { status?: string } | void,
  { state: RootState; rejectValue: string }
>("agentSkillDrafts/fetch", async (arg, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const status = (arg && arg.status) || "pending";
    const response = await skillsApi.listSkillDrafts({ organizationId, status });
    return response.drafts.map(skillDraftToPlain);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch drafts");
  }
});

export const fetchSkillDraft = createAsyncThunk<
  SerializedSkillDraft,
  string,
  { state: RootState; rejectValue: string }
>("agentSkillDrafts/fetchOne", async (draftId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await skillsApi.getSkillDraft({ organizationId, draftId });
    if (!response.draft) throw new Error("No draft in response");
    return skillDraftToPlain(response.draft);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch draft");
  }
});

export const createSkillDraft = createAsyncThunk<
  SerializedSkillDraft,
  {
    kind: "create" | "edit" | "evolve";
    targetSkillId?: string;
    name: string;
    displayName: string;
    description?: string;
    content: string;
    whenToUse?: string;
    requiresTools?: string[];
    requiresContext?: string[];
    suggestedAlwaysActive?: boolean;
    rationale?: string;
  },
  { state: RootState; rejectValue: string }
>("agentSkillDrafts/create", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await skillsApi.createSkillDraft({
      organizationId,
      kind: params.kind,
      targetSkillId: params.targetSkillId,
      name: params.name,
      displayName: params.displayName,
      description: params.description ?? "",
      content: params.content,
      whenToUse: params.whenToUse ?? "",
      requiresTools: params.requiresTools ?? [],
      requiresContext: params.requiresContext ?? [],
      suggestedAlwaysActive: params.suggestedAlwaysActive ?? false,
      rationale: params.rationale ?? "",
    });
    if (!response.draft) throw new Error("No draft in response");
    return skillDraftToPlain(response.draft);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create draft");
  }
});

export const saveSkillDraft = createAsyncThunk<
  { draftId: string; skill: ReturnType<typeof skillToPlain> },
  { draftId: string; fields: SaveDraftFields; allowReplace?: boolean },
  { state: RootState; rejectValue: string }
>(
  "agentSkillDrafts/save",
  async ({ draftId, fields, allowReplace }, { getState, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const response = await skillsApi.saveSkillDraft({
        organizationId,
        draftId,
        name: fields.name,
        displayName: fields.displayName,
        description: fields.description,
        content: fields.content,
        whenToUse: fields.whenToUse,
        requiresTools: fields.requiresTools,
        requiresContext: fields.requiresContext,
        suggestedAlwaysActive: fields.suggestedAlwaysActive,
        changeSummary: fields.changeSummary ?? "",
        allowReplace: allowReplace ?? false,
      });
      if (!response.skill) throw new Error("No skill in response");
      return { draftId, skill: skillToPlain(response.skill) };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to save draft");
    }
  },
);

export const discardSkillDraft = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("agentSkillDrafts/discard", async (draftId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await skillsApi.discardSkillDraft({ organizationId, draftId });
    return draftId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to discard draft");
  }
});
