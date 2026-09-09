import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { SkillDraftSchema } from "@uniffy/proto/agents/v1/skills_pb";
import {
  agentSkillDraftsReducer,
  selectInboxCount,
  selectSessionDrafts,
} from "@/features/agents/store/agentSkillDraftsSlice";
import {
  skillDraftToPlain,
  fetchSkillDraft,
  generateSkillDraft,
  retrySkillDraftGeneration,
  discardSkillDraft,
  type SerializedSkillDraft,
} from "@/features/agents/store/agentSkillDraftsThunks";
import { logout, setCredentials } from "@/features/auth/store/authSlice";
import { skillsApi } from "@/features/agents/api/skillsApi";

vi.mock("@/features/agents/api/skillsApi", () => ({
  skillsApi: {
    generateSkillDraft: vi.fn(),
    retrySkillDraftGeneration: vi.fn(),
  },
}));

const fields = {
  requestId: "draft",
  agentId: "agent",
  sessionId: "session",
  evidenceMessageIds: ["request", "reply"],
  rationale: "Make the report reusable",
};
const draft = (overrides: Partial<SerializedSkillDraft> = {}) => ({
  ...skillDraftToPlain(
    create(SkillDraftSchema, {
      id: "draft",
      organizationId: "org",
      ownerId: "user",
      sessionId: "session",
      status: "generating",
      generationAttempt: 1,
    }),
  ),
  ...overrides,
});

function requested() {
  return agentSkillDraftsReducer(undefined, generateSkillDraft.pending("request", fields));
}

function generated() {
  return agentSkillDraftsReducer(
    requested(),
    generateSkillDraft.fulfilled(draft(), "request", fields),
  );
}

describe("skill draft lifecycle", () => {
  it("keeps one draft through repeated generation responses and session lookup", () => {
    let state = generated();
    state = agentSkillDraftsReducer(state, generateSkillDraft.pending("duplicate", fields));
    state = agentSkillDraftsReducer(
      state,
      generateSkillDraft.fulfilled(draft(), "duplicate", fields),
    );
    const root = { agentSkillDrafts: state } as never;
    expect(selectInboxCount(root)).toBe(1);
    expect(selectSessionDrafts("session")(root)).toHaveLength(1);
    expect(selectSessionDrafts("another-session")(root)).toEqual([]);
  });

  it("hydrates a generated proposal into the review editor", () => {
    let state = generated();
    state = agentSkillDraftsReducer(state, fetchSkillDraft.pending("poll", "draft"));
    state = agentSkillDraftsReducer(
      state,
      fetchSkillDraft.fulfilled(
        draft({ status: "pending", content: "Instructions" }),
        "poll",
        "draft",
      ),
    );
    expect(state.byId.draft.status).toBe("pending");
    expect(state.byId.draft.content).toBe("Instructions");
  });

  it("does not let an older attempt overwrite an explicit retry", () => {
    let state = generated();
    const retry = { draftId: "draft", expectedAttempt: 1 };
    state = agentSkillDraftsReducer(state, fetchSkillDraft.pending("poll", "draft"));
    state = agentSkillDraftsReducer(state, retrySkillDraftGeneration.pending("retry", retry));
    state = agentSkillDraftsReducer(
      state,
      retrySkillDraftGeneration.fulfilled(draft({ generationAttempt: 2 }), "retry", retry),
    );
    state = agentSkillDraftsReducer(
      state,
      fetchSkillDraft.fulfilled(draft({ status: "generation_failed" }), "poll", "draft"),
    );
    expect(state.byId.draft.generationAttempt).toBe(2);
    expect(state.byId.draft.status).toBe("generating");
  });

  it("does not restore a discarded draft from an in-flight poll", () => {
    let state = generated();
    state = agentSkillDraftsReducer(state, fetchSkillDraft.pending("poll", "draft"));
    state = agentSkillDraftsReducer(state, discardSkillDraft.pending("discard", "draft"));
    state = agentSkillDraftsReducer(
      state,
      discardSkillDraft.fulfilled("draft", "discard", "draft"),
    );
    state = agentSkillDraftsReducer(
      state,
      fetchSkillDraft.fulfilled(draft({ status: "pending" }), "poll", "draft"),
    );
    expect(state.byId.draft.status).toBe("discarded");
    expect(state.inboxIds).toEqual([]);
  });

  it("clears drafts and ignores delayed results after logout", () => {
    let state = requested();
    state = agentSkillDraftsReducer(state, logout());
    state = agentSkillDraftsReducer(
      state,
      generateSkillDraft.fulfilled(draft(), "request", fields),
    );
    expect(state.byId).toEqual({});
    expect(state.requests).toEqual({});
  });

  it("ignores a previous organization's delayed generation response", () => {
    let state = requested();
    state = agentSkillDraftsReducer(state, setCredentials({ organizationId: "other" } as never));
    state = agentSkillDraftsReducer(
      state,
      generateSkillDraft.fulfilled(draft(), "request", fields),
    );
    expect(state.organizationId).toBe("other");
    expect(state.byId).toEqual({});
  });

  it("preserves exact invocation and version facts in serialization", () => {
    const plain = skillDraftToPlain(
      create(SkillDraftSchema, {
        invocationId: "invocation",
        targetVersionId: "immutable-version",
        targetVersionNumber: 3,
        generationError: "access_revoked",
      }),
    );
    expect(plain.invocationId).toBe("invocation");
    expect(plain.targetVersionId).toBe("immutable-version");
    expect(plain.targetVersionNumber).toBe(3);
    expect(plain.generationError).toBe("access_revoked");
  });

  it("clears pending requests when the account changes within the same organization", () => {
    let state = agentSkillDraftsReducer(
      undefined,
      setCredentials({ organizationId: "org", user: { id: "first" } } as never),
    );
    state = agentSkillDraftsReducer(state, generateSkillDraft.pending("request", fields));
    state = agentSkillDraftsReducer(
      state,
      setCredentials({ organizationId: "org", user: { id: "second" } } as never),
    );
    state = agentSkillDraftsReducer(
      state,
      generateSkillDraft.fulfilled(draft(), "request", fields),
    );
    expect(state.userId).toBe("second");
    expect(state.byId).toEqual({});
  });
});

describe("explicit generation requests", () => {
  it("sends only selected IDs and rationale under the active organization", async () => {
    vi.mocked(skillsApi.generateSkillDraft).mockResolvedValue({
      draft: create(SkillDraftSchema, { id: "draft", status: "generating" }),
    } as never);
    const getState = () => ({ auth: { currentOrganizationId: "org" } });
    const result = await generateSkillDraft(fields)(vi.fn(), getState as never, undefined);
    expect(generateSkillDraft.fulfilled.match(result)).toBe(true);
    expect(skillsApi.generateSkillDraft).toHaveBeenCalledWith({ ...fields, organizationId: "org" });
  });

  it("does not silently retry a failed request", async () => {
    vi.mocked(skillsApi.generateSkillDraft).mockClear().mockRejectedValue(new Error("Unavailable"));
    const getState = () => ({ auth: { currentOrganizationId: "org" } });
    const result = await generateSkillDraft(fields)(vi.fn(), getState as never, undefined);
    expect(generateSkillDraft.rejected.match(result)).toBe(true);
    expect(skillsApi.generateSkillDraft).toHaveBeenCalledTimes(1);
    expect(skillsApi.retrySkillDraftGeneration).not.toHaveBeenCalled();
  });
});
