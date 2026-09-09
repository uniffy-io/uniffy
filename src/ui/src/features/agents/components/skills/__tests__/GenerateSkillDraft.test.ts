import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerateSkillDraftDialog } from "@/features/agents/components/skills/GenerateSkillDraftDialog";
import { SkillResponseActions } from "@/features/agents/components/skills/SkillResponseActions";
import { SkillDraftStatus } from "@/features/agents/components/skills/SkillDraftStatus";

const mocks = vi.hoisted(() => ({ state: {}, dispatch: vi.fn() }));

vi.mock("@/app/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) => selector(mocks.state),
}));

vi.mock("@/components/ui/modal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/modal")>()),
  Modal: ({ children }: { children: ReactNode }) =>
    createElement("div", { role: "dialog" }, children),
}));

function render(child: ReactNode) {
  return renderToStaticMarkup(createElement(MemoryRouter, {}, child));
}

const attribution = {
  skill_invocation_id: "invocation",
  skill_id: "skill",
  skill_version_id: "exact-version",
  skill_version_number: "3",
  skill_display_name: "Report",
  skill_actor_user_id: "requester",
  skill_trigger_message_id: "trigger",
};

function state(userId = "requester", builder = false) {
  mocks.state = {
    auth: {
      user: { id: userId },
      currentOrganizationId: "org",
      currentOrganizationRole: builder ? "ADMIN" : "MEMBER",
      domainAdminDomains: [],
    },
    agentSkillDrafts: { byId: {} },
  };
}

function actions(facts: Record<string, string> = attribution) {
  return render(
    createElement(SkillResponseActions, {
      agentId: "agent",
      channelId: "channel",
      responseMessageId: "reply",
      attribution: facts,
    }),
  );
}

function status(value: string) {
  return render(
    createElement(SkillDraftStatus, {
      draftId: "draft",
      status: value,
      ownerId: "requester",
      generationAttempt: 1,
      generationError: "queue_unavailable",
    }),
  );
}

describe("explicit skill generation controls", () => {
  beforeEach(() => {
    state();
    mocks.dispatch.mockClear();
  });

  it("shows the exact version and Improve only to the invocation's actor", () => {
    expect(actions()).toContain("Used Report v3");
    expect(actions()).toContain("Improve this skill");
    expect(actions()).not.toContain('href="/agents/skills/skill"');
    state("another");
    expect(actions()).not.toContain("Improve this skill");
    expect(actions()).toContain("Create skill from conversation");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("never guesses an improvement target for an ordinary response", () => {
    expect(actions({})).not.toContain("Improve this skill");
    expect(actions({})).not.toContain("Used ");
  });

  it("links builders to the attributed skill", () => {
    state("requester", true);
    expect(actions()).toContain('href="/agents/skills/skill"');
  });

  it("opening the dialog renders bounded explanation and explicit confirmation without a request", () => {
    const markup = render(
      createElement(GenerateSkillDraftDialog, {
        evidence: {
          agentId: "agent",
          channelId: "channel",
          evidenceMessageIds: ["trigger", "reply"],
          invocationId: "invocation",
        },
        skillLabel: "Report v3",
        onClose: vi.fn(),
        onCreated: vi.fn(),
      }),
    );
    expect(markup).toContain("Report v3");
    expect(markup).toContain('maxLength="2000"');
    expect(markup).toContain("What should improve?");
    expect(markup).toContain("Cancel");
    expect(markup).toContain("Generate draft");
    expect(markup).toContain("disabled");
    expect(markup).toContain("builders for review");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("renders generation and failure states without automatically retrying", () => {
    expect(status("generating")).toContain("Generating skill draft...");
    expect(status("generation_failed")).toContain("Retry generation");
    expect(status("generation_failed")).toContain("Generation is unavailable.");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("keeps retry with the requester and review with builders", () => {
    state("another", true);
    expect(status("generation_failed")).not.toContain("Retry generation");
    expect(status("pending")).toContain("Review and save");
    state("requester");
    expect(status("pending")).toContain("Waiting for a builder");
    expect(status("pending")).not.toContain("Review and save");
  });
});
