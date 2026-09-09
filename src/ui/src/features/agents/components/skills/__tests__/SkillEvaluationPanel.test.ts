import { create } from "@bufbuild/protobuf";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EvaluationCaseSchema,
  EvaluationRunSchema,
  EvaluationStatus,
} from "@uniffy/proto/agents/v1/skill_evaluations_pb";
import { EvaluationCaseDialog } from "@/features/agents/components/skills/EvaluationCaseDialog";
import { SkillEvaluationPanel } from "@/features/agents/components/skills/SkillEvaluationPanel";
import {
  SkillEvaluationComparison,
  SkillEvaluationResults,
} from "@/features/agents/components/skills/SkillEvaluationResults";
import {
  evaluationCaseToPlain,
  evaluationRunToPlain,
} from "@/features/agents/store/agentSkillEvaluationsSerde";
import { agentSkillEvaluationsReducer } from "@/features/agents/store/agentSkillEvaluationsSlice";
import { setCredentials } from "@/features/auth/store/authSlice";

const mocks = vi.hoisted(() => ({ state: {}, dispatch: vi.fn() }));
vi.mock("@/app/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) => selector(mocks.state),
}));
vi.mock("@/components/editor/CrepeEditor", () => ({
  CrepeEditor: ({ value }: { value: string }) => createElement("div", {}, value),
}));
vi.mock("@/components/ui/modal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/modal")>()),
  Modal: ({ children }: { children: ReactNode }) =>
    createElement("div", { role: "dialog" }, children),
}));
vi.mock("@/features/agents/components/instruction/InstructionDetailLayout", () => ({
  DetailToggleSection: ({ children }: { children: ReactNode }) =>
    createElement("section", {}, children),
}));

const context = { organizationId: "org", scope: { skillId: "skill" } };
const makeRun = (requestId: string, draftId = "") =>
  evaluationRunToPlain(
    create(EvaluationRunSchema, {
      id: requestId,
      requestId,
      caseId: "case",
      skillId: "skill",
      skillVersionId: draftId ? "" : "version",
      versionNumber: draftId ? 0 : 2,
      draftId,
      targetDigest: draftId ? "abcdef123456" : "saved",
      status: draftId ? EvaluationStatus.FAILED : EvaluationStatus.PASSED,
      caseSnapshot: { name: "Check report", input: "Write a report" },
      model: "model",
      cost: "0.003",
      costCurrency: "USD",
      createdAt: { seconds: 1n },
    }),
  );
const render = (child: ReactNode) => renderToStaticMarkup(child);

describe("skill evaluation controls", () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.state = {
      auth: { currentOrganizationId: "org", user: { id: "builder" } },
      agents: { agents: {} },
      agentSkills: { skills: {} },
      agentSkillVersions: { bySkill: {} },
      agentTools: { tools: [{ name: "notes.create_note", displayName: "Create note" }] },
      agentSkillEvaluations: agentSkillEvaluationsReducer(
        undefined,
        setCredentials({ organizationId: "org", user: { id: "builder" } } as Parameters<
          typeof setCredentials
        >[0]),
      ),
    };
  });

  it("renders the panel without generation, evaluation, or save requests", () => {
    const html = render(
      createElement(SkillEvaluationPanel, {
        skillId: "skill",
        draftId: "draft",
        draftContent: "Editor body",
      }),
    );
    expect(html).toContain("Run suite");
    expect(html).toContain("Compare active version and draft");
    expect(html).toContain("Judge cases with a rubric");
    expect(html).toContain("count toward AI usage and budgets");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("opens the case editor without model work and explains fixture behavior", () => {
    const evaluationCase = evaluationCaseToPlain(
      create(EvaluationCaseSchema, {
        id: "case",
        fields: {
          name: "Check report",
          input: "Write report",
          fixtures: [{ toolName: "notes.create_note", response: "Sample note", isError: true }],
        },
      }),
    );
    const html = render(
      createElement(EvaluationCaseDialog, { context, evaluationCase, onClose: vi.fn() }),
    );
    expect(html).toContain("Edit evaluation case");
    expect(html).toContain("Sample note");
    expect(html).toContain("Calls never read or change workspace data");
    expect(html).toContain("Return an error");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("compares the two explicit requests for each case without promoting a result", () => {
    const html = render(
      createElement(SkillEvaluationComparison, {
        runs: [makeRun("active"), makeRun("draft", "draft"), makeRun("unrelated")],
        requestIds: ["active", "draft"],
      }),
    );
    expect(html).toContain("Active version 2");
    expect(html).toContain("abcdef12");
    expect(html).toContain("Passed");
    expect(html).toContain("Failed");
    expect(html).toContain("saving the draft is a separate action");
    expect(html).not.toContain("<button");
  });

  it("explains case changes between comparison snapshots", () => {
    const draft = makeRun("draft", "draft");
    draft.caseSnapshot.input = "Edited case";
    const html = render(
      createElement(SkillEvaluationComparison, {
        runs: [makeRun("active"), draft],
        requestIds: ["active", "draft"],
      }),
    );
    expect(html).toContain("case changed between requests");
  });

  it("lists exact targets and recorded model costs with expandable details", () => {
    const html = render(
      createElement(SkillEvaluationResults, {
        runs: [makeRun("active"), makeRun("draft", "draft")],
      }),
    );
    expect(html).toContain("Version 2");
    expect(html).toContain("Draft · abcdef12");
    expect(html).toContain("$0.0030");
    expect(html).toContain('aria-expanded="false"');
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
