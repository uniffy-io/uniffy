import { describe, expect, it } from "vitest";
import type { SkillDraft } from "@uniffy/proto/agents/v1/skills_pb";
import {
  agentSkillDraftsReducer,
  upsertProposedDraft,
  selectInboxDrafts,
  selectInboxCount,
  selectSessionDrafts,
  selectDraftById,
} from "@/features/agents/store/agentSkillDraftsSlice";
import {
  skillDraftToPlain,
  fetchSkillDrafts,
  fetchSkillDraft,
  saveSkillDraft,
  discardSkillDraft,
  createSkillDraft,
  type SerializedSkillDraft,
} from "@/features/agents/store/agentSkillDraftsThunks";

const SESSION = "sess-1";

const draft = (id: string, over: Partial<SerializedSkillDraft> = {}): SerializedSkillDraft => ({
  id,
  organizationId: "org-1",
  ownerId: "user-1",
  targetSkillId: undefined,
  kind: "create",
  proposedByAgentId: undefined,
  sessionId: SESSION,
  channelId: undefined,
  originChatMessageId: undefined,
  rationale: "",
  name: `skill-${id}`,
  displayName: `Skill ${id}`,
  description: "",
  content: "body",
  whenToUse: "",
  requiresTools: [],
  requiresContext: [],
  suggestedAlwaysActive: false,
  status: "pending",
  createdAt: undefined,
  updatedAt: undefined,
  ...over,
});

describe("skillDraftToPlain", () => {
  it("maps proto fields and normalizes optional + repeated fields", () => {
    const proto = {
      id: "d1",
      organizationId: "org-1",
      ownerId: "user-1",
      targetSkillId: undefined,
      kind: "edit",
      proposedByAgentId: "agent-1",
      sessionId: undefined,
      channelId: undefined,
      originChatMessageId: undefined,
      rationale: "because",
      name: "report",
      displayName: "Report",
      description: "desc",
      content: "body",
      whenToUse: "asked",
      requiresTools: ["search.query"],
      requiresContext: [],
      suggestedAlwaysActive: true,
      status: "pending",
      createdAt: undefined,
      updatedAt: undefined,
    } as unknown as SkillDraft;

    const plain = skillDraftToPlain(proto);
    expect(plain.kind).toBe("edit");
    expect(plain.proposedByAgentId).toBe("agent-1");
    expect(plain.targetSkillId).toBeUndefined();
    expect(plain.requiresTools).toEqual(["search.query"]);
    expect(plain.suggestedAlwaysActive).toBe(true);
  });
});

describe("agentSkillDrafts slice", () => {
  it("upserts a proposed draft into inbox + session bucket", () => {
    const state = agentSkillDraftsReducer(
      undefined,
      upsertProposedDraft({ draft: draft("d1"), sessionId: SESSION }),
    );
    const root = { agentSkillDrafts: state } as never;
    expect(selectInboxCount(root)).toBe(1);
    expect(selectInboxDrafts(root)).toHaveLength(1);
    expect(selectSessionDrafts(SESSION)(root)).toHaveLength(1);
    expect(selectSessionDrafts("other")(root)).toEqual([]);
    expect(selectDraftById("d1")(root)?.name).toBe("skill-d1");
  });

  it("does not double-add the same draft to the inbox", () => {
    let state = agentSkillDraftsReducer(
      undefined,
      upsertProposedDraft({ draft: draft("d1"), sessionId: SESSION }),
    );
    state = agentSkillDraftsReducer(
      state,
      upsertProposedDraft({ draft: draft("d1"), sessionId: SESSION }),
    );
    expect(state.inboxIds).toEqual(["d1"]);
    expect(state.idsBySession[SESSION]).toEqual(["d1"]);
  });

  it("fetch replaces the inbox", () => {
    const state = agentSkillDraftsReducer(
      undefined,
      fetchSkillDrafts.fulfilled([draft("a"), draft("b")], "req", undefined),
    );
    const root = { agentSkillDrafts: state } as never;
    expect(selectInboxDrafts(root).map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("saving a draft marks it saved and drops it from the inbox", () => {
    let state = agentSkillDraftsReducer(
      undefined,
      upsertProposedDraft({ draft: draft("d1"), sessionId: SESSION }),
    );
    state = agentSkillDraftsReducer(
      state,
      saveSkillDraft.fulfilled({ draftId: "d1", skill: { id: "skill-x" } as never }, "req", {
        draftId: "d1",
        fields: {} as never,
      }),
    );
    expect(state.inboxIds).toEqual([]);
    expect(state.byId["d1"].status).toBe("saved");
    // The inline session card persists so the user sees the resolved state.
    expect(state.idsBySession[SESSION]).toEqual(["d1"]);
  });

  it("discarding a draft marks it discarded and drops it from the inbox", () => {
    let state = agentSkillDraftsReducer(
      undefined,
      upsertProposedDraft({ draft: draft("d1"), sessionId: SESSION }),
    );
    state = agentSkillDraftsReducer(state, discardSkillDraft.fulfilled("d1", "req", "d1"));
    expect(state.inboxIds).toEqual([]);
    expect(state.byId["d1"].status).toBe("discarded");
  });

  it("createSkillDraft.fulfilled seeds a pending draft into the inbox", () => {
    const state = agentSkillDraftsReducer(
      undefined,
      createSkillDraft.fulfilled(draft("new"), "req", {
        kind: "create",
        name: "x",
        displayName: "X",
        content: "y",
      }),
    );
    expect(state.inboxIds).toEqual(["new"]);
  });

  it("fetching a single draft for the editor carries the plain draft but does not touch the store", () => {
    let state = agentSkillDraftsReducer(
      undefined,
      upsertProposedDraft({ draft: draft("d1"), sessionId: SESSION }),
    );
    const action = fetchSkillDraft.fulfilled(draft("d2"), "req", "d2");
    expect(action.payload.id).toBe("d2");
    state = agentSkillDraftsReducer(state, action);
    expect(state.inboxIds).toEqual(["d1"]);
    expect(state.byId["d2"]).toBeUndefined();
    expect(state.idsBySession[SESSION]).toEqual(["d1"]);
  });

  it("a rejected single-draft fetch leaves the store intact", () => {
    let state = agentSkillDraftsReducer(
      undefined,
      upsertProposedDraft({ draft: draft("d1"), sessionId: SESSION }),
    );
    state = agentSkillDraftsReducer(
      state,
      fetchSkillDraft.rejected(new Error("nope"), "req", "d2"),
    );
    const root = { agentSkillDrafts: state } as never;
    expect(selectInboxCount(root)).toBe(1);
    expect(selectInboxDrafts(root).map((d) => d.id)).toEqual(["d1"]);
    expect(state.byId["d1"].status).toBe("pending");
  });
});
