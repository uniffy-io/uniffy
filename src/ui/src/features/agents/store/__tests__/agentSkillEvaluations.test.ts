import { create } from "@bufbuild/protobuf";
import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreateCaseResponseSchema,
  EvaluationCaseSchema,
  EvaluationRunSchema,
  EvaluationStatus,
  ListRunsResponseSchema,
  RunCaseResponseSchema,
} from "@uniffy/proto/agents/v1/skill_evaluations_pb";
import {
  GetSkillVersionResponseSchema,
  ListSkillVersionsResponseSchema,
} from "@uniffy/proto/agents/v1/skills_pb";
import type { RootState } from "@/app/store";
import { skillEvaluationsApi } from "@/features/agents/api/skillEvaluationsApi";
import { skillsApi } from "@/features/agents/api/skillsApi";
import { agentSkillEvaluationsReducer as reduce } from "@/features/agents/store/agentSkillEvaluationsSlice";
import {
  evaluationCaseToPlain,
  evaluationRunToPlain,
  type SerializedEvaluationRun,
} from "@/features/agents/store/agentSkillEvaluationsSerde";
import {
  deleteEvaluationCase,
  fetchEvaluationCases,
  fetchEvaluationRun,
  fetchEvaluationRuns,
  runSkillEvaluation,
  saveEvaluationCase,
} from "@/features/agents/store/agentSkillEvaluationsThunks";
import { fetchSkillVersions } from "@/features/agents/store/agentSkillVersionsThunks";
import { logout, rehydrateFailed, setCredentials } from "@/features/auth/store/authSlice";

vi.mock("@/features/agents/api/skillEvaluationsApi", () => ({
  skillEvaluationsApi: {
    listCases: vi.fn(),
    createCase: vi.fn(),
    updateCase: vi.fn(),
    deleteCase: vi.fn(),
    runCase: vi.fn(),
    runSuite: vi.fn(),
    getRun: vi.fn(),
    listRuns: vi.fn(),
  },
}));
vi.mock("@/features/agents/api/skillsApi", () => ({
  skillsApi: { listSkillVersions: vi.fn(), getSkillVersion: vi.fn() },
}));

const context = { organizationId: "org", scope: { skillId: "skill" } };
const history = { ...context, agentId: "agent" };
const params = {
  ...history,
  requestId: "explicit-request",
  caseIds: ["case"],
  judge: false,
  target: { skillVersionId: "version" },
};
const credentials = (org = "org", user = "builder") => ({
  organizationId: org,
  user: { id: user } as Parameters<typeof setCredentials>[0]["user"],
  accessToken: "token",
  refreshToken: "refresh",
});
const sampleCase = evaluationCaseToPlain(
  create(EvaluationCaseSchema, { id: "case", fields: { name: "Report", input: "Write a report" } }),
);
const run = (overrides: Partial<SerializedEvaluationRun> = {}) => ({
  ...evaluationRunToPlain(
    create(EvaluationRunSchema, {
      id: "run",
      requestId: "explicit-request",
      caseId: "case",
      agentId: "agent",
      status: EvaluationStatus.QUEUED,
    }),
  ),
  ...overrides,
});
function initial() {
  let state = reduce(undefined, setCredentials(credentials()));
  state = reduce(state, fetchEvaluationCases.pending("cases", context));
  state = reduce(state, fetchEvaluationCases.fulfilled([sampleCase], "cases", context));
  state = reduce(state, fetchEvaluationRuns.pending("history", history));
  return reduce(
    state,
    fetchEvaluationRuns.fulfilled({ runs: [], nextCursor: "" }, "history", history),
  );
}
const start = (id = "request") => runSkillEvaluation.pending(id, params);
const finish = (id = "request", value = run()) => runSkillEvaluation.fulfilled([value], id, params);

describe("evaluation state isolation", () => {
  it("serializes timestamps and exact draft/version observations without protobuf values", () => {
    const value = evaluationRunToPlain(
      create(EvaluationRunSchema, {
        id: "run",
        draftId: "draft",
        targetDigest: "digest",
        createdAt: { seconds: 1n },
        toolAttempts: [
          {
            toolName: "notes.create_note",
            inputJson: "{}",
            fixtureUsed: true,
            fixtureResponse: "sample",
          },
        ],
      }),
    );
    expect(value.createdAt).toBe("1970-01-01T00:00:01.000Z");
    expect(JSON.stringify(value)).not.toContain("$typeName");
    expect(value.toolAttempts[0].fixtureUsed).toBe(true);
  });

  it.each([
    logout(),
    rehydrateFailed(),
    setCredentials(credentials("another")),
    setCredentials(credentials("org", "someone-else")),
  ])("clears data and refuses stale requests on $type", (action) => {
    const state = reduce(reduce(initial(), start()), action);
    expect(state.cases).toEqual([]);
    expect(state.runs).toEqual([]);
    expect(reduce(state, finish())).toEqual(state);
  });

  it("switches scope and agent without accepting prior responses", () => {
    let state = reduce(initial(), start());
    state = reduce(state, fetchEvaluationRuns.pending("another", { ...history, agentId: "other" }));
    expect(reduce(state, finish())).toEqual(state);
    state = reduce(
      state,
      fetchEvaluationCases.pending("draft", { ...context, scope: { draftId: "draft" } }),
    );
    expect(state.cases).toEqual([]);
    expect(
      reduce(
        state,
        fetchEvaluationRuns.fulfilled({ runs: [run()], nextCursor: "" }, "another", {
          ...history,
          agentId: "other",
        }),
      ),
    ).toEqual(state);
  });

  it("ignores older list responses and never regresses a completed run", () => {
    let state = reduce(
      reduce(initial(), start()),
      finish("request", run({ status: EvaluationStatus.PASSED, output: "Done" })),
    );
    state = reduce(state, fetchEvaluationRuns.pending("old", history));
    state = reduce(state, fetchEvaluationRuns.pending("new", history));
    expect(
      reduce(state, fetchEvaluationRuns.fulfilled({ runs: [], nextCursor: "" }, "old", history)),
    ).toEqual(state);
    state = reduce(
      state,
      fetchEvaluationRuns.fulfilled({ runs: [run()], nextCursor: "next" }, "new", history),
    );
    expect(state.runs[0].status).toBe(EvaluationStatus.PASSED);
    expect(state.runs[0].output).toBe("Done");
    state = reduce(state, fetchEvaluationRuns.pending("page", { ...history, cursor: "next" }));
    expect(state.runs).toEqual([]);
  });

  it("keeps simultaneous comparison requests and deduplicates repeated run IDs", () => {
    const draftParams = {
      ...params,
      requestId: "draft-request",
      target: { draftId: "draft", draftContent: "Editor body" },
    };
    let state = reduce(
      reduce(initial(), start()),
      runSkillEvaluation.pending("draft", draftParams),
    );
    state = reduce(state, finish());
    state = reduce(
      state,
      runSkillEvaluation.fulfilled(
        [run({ id: "draft-run", requestId: "draft-request", draftId: "draft" })],
        "draft",
        draftParams,
      ),
    );
    state = reduce(reduce(state, start("retry")), finish("retry"));
    expect(state.runs).toHaveLength(2);
  });

  it("does not let a stale case refresh undo an edit or deletion", () => {
    const save = { ...context, caseId: "case", fields: { ...sampleCase.fields, name: "Edited" } };
    let state = reduce(initial(), fetchEvaluationCases.pending("old", context));
    state = reduce(state, saveEvaluationCase.pending("save", save));
    state = reduce(
      state,
      saveEvaluationCase.fulfilled({ ...sampleCase, fields: save.fields }, "save", save),
    );
    state = reduce(state, fetchEvaluationCases.fulfilled([sampleCase], "old", context));
    expect(state.cases[0].fields.name).toBe("Edited");
    const remove = { ...context, caseId: "case" };
    state = reduce(state, deleteEvaluationCase.pending("delete", remove));
    state = reduce(state, deleteEvaluationCase.fulfilled("case", "delete", remove));
    expect(state.cases).toEqual([]);
  });

  it("removes results when permission-sensitive refreshes fail", () => {
    const poll = { ...history, runId: "run" };
    let state = reduce(reduce(initial(), start()), finish());
    state = reduce(state, fetchEvaluationRun.pending("poll", poll));
    state = reduce(state, fetchEvaluationRun.rejected(null, "poll", poll, "Forbidden"));
    expect(state.runs).toEqual([]);
  });
});

describe("explicit evaluation requests", () => {
  beforeEach(() => vi.clearAllMocks());
  const store = () =>
    configureStore({
      reducer: {
        auth: () => ({ currentOrganizationId: "org" }),
        agentSkillEvaluations: reduce,
      },
    });
  async function dispatchThunk(
    action:
      | ReturnType<typeof runSkillEvaluation>
      | ReturnType<typeof saveEvaluationCase>
      | ReturnType<typeof fetchEvaluationRuns>
      | ReturnType<typeof fetchSkillVersions>,
  ) {
    const current = store();
    return action(current.dispatch, () => current.getState() as RootState, undefined);
  }
  it("case editing never requests a model run", async () => {
    vi.mocked(skillEvaluationsApi.createCase).mockResolvedValue(
      create(CreateCaseResponseSchema, { evaluationCase: { id: "case" } }),
    );
    await dispatchThunk(saveEvaluationCase({ ...context, fields: sampleCase.fields }));
    expect(skillEvaluationsApi.createCase).toHaveBeenCalledWith({
      organizationId: "org",
      scope: { scope: { case: "skillId", value: "skill" } },
      fields: sampleCase.fields,
    });
    expect(skillEvaluationsApi.runCase).not.toHaveBeenCalled();
    expect(skillEvaluationsApi.runSuite).not.toHaveBeenCalled();
  });
  it("sends explicit draft content and judge consent with the caller's request ID", async () => {
    vi.mocked(skillEvaluationsApi.runCase).mockResolvedValue(create(RunCaseResponseSchema));
    await dispatchThunk(
      runSkillEvaluation({
        ...params,
        target: { draftId: "draft", draftContent: "Current editor body" },
        judge: true,
        singleCase: true,
      }),
    );
    expect(skillEvaluationsApi.runCase).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "explicit-request",
        judge: true,
        caseIds: ["case"],
        target: {
          target: { case: "draftId", value: "draft" },
          draftContent: "Current editor body",
        },
      }),
    );
    expect(skillEvaluationsApi.runSuite).not.toHaveBeenCalled();
  });
  it("refuses a stale organization before any API request", async () => {
    const result = await dispatchThunk(
      runSkillEvaluation({ ...params, organizationId: "foreign" }),
    );
    expect(runSkillEvaluation.rejected.match(result)).toBe(true);
    expect(skillEvaluationsApi.runSuite).not.toHaveBeenCalled();
  });
  it("pages history without starting or retrying an evaluation", async () => {
    vi.mocked(skillEvaluationsApi.listRuns).mockResolvedValue(create(ListRunsResponseSchema));
    await dispatchThunk(fetchEvaluationRuns({ ...history, cursor: "older" }));
    expect(skillEvaluationsApi.listRuns).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "older", pageSize: 50 }),
    );
    expect(skillEvaluationsApi.runSuite).not.toHaveBeenCalled();
  });
  it("loads an active pinned version outside the recent history page", async () => {
    vi.mocked(skillsApi.listSkillVersions).mockResolvedValue(
      create(ListSkillVersionsResponseSchema, {
        versions: [{ id: "recent", versionNumber: 99 }],
        activeVersionNumber: 2,
        activeVersionPinned: true,
        latestVersionNumber: 99,
      }),
    );
    vi.mocked(skillsApi.getSkillVersion).mockResolvedValue(
      create(GetSkillVersionResponseSchema, { version: { id: "pinned", versionNumber: 2 } }),
    );
    const result = await dispatchThunk(fetchSkillVersions("skill"));
    expect(skillsApi.getSkillVersion).toHaveBeenCalledWith({
      organizationId: "org",
      skillId: "skill",
      versionNumber: 2,
    });
    expect(
      fetchSkillVersions.fulfilled.match(result) &&
        result.payload.versions.map((version) => version.id),
    ).toEqual(["recent", "pinned"]);
  });
});
