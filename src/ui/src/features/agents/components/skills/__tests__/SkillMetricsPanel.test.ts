import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillMetricsPanel } from "@/features/agents/components/skills/SkillMetricsPanel";
import type { SkillMetricsEntry } from "@/features/agents/store/agentSkillMetricsSlice";
import type { SerializedSkillMetric } from "@/features/agents/store/agentSkillMetricsThunks";

const mocks = vi.hoisted(() => ({ state: {}, dispatch: vi.fn() }));

vi.mock("@/app/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) => selector(mocks.state),
}));

vi.mock("@/features/agents/api/skillsApi", () => ({
  skillsApi: { getSkillMetrics: vi.fn() },
}));

const metric: SerializedSkillMetric = {
  skillId: "skill-1",
  skillVersionId: "version-3",
  skillVersionNumber: 3,
  displayName: "Release checklist",
  invocationCount: 4,
  startedCount: 0,
  completedCount: 2,
  failedCount: 1,
  rejectedCount: 0,
  cancelledCount: 1,
  toolErrorRunCount: 1,
  toolErrorRate: 0.25,
  uniqueUsers: 2,
  runLogCount: 2,
  durationMs: 6000,
  inputTokens: 1000,
  outputTokens: 200,
  costs: [
    { currency: "USD", amount: "1.25", runCount: 1 },
    { currency: "EUR", amount: "0.50", runCount: 1 },
  ],
};

function renderPanel(entry?: SkillMetricsEntry, skillId = "") {
  mocks.state = {
    auth: { currentOrganizationId: "org-1" },
    agentSkillMetrics: {
      organizationId: "org-1",
      entries: entry ? { [`${skillId || "org"}:30`]: entry } : {},
    },
  };
  return renderToStaticMarkup(
    createElement(MemoryRouter, {}, createElement(SkillMetricsPanel, { skillId })),
  );
}

describe("SkillMetricsPanel", () => {
  beforeEach(() => mocks.dispatch.mockClear());

  it("keeps wide tables in a keyboard-accessible bounded scroller with a local sticky header", () => {
    const markup = renderPanel();
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Skill invocation observations"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("overflow-auto");
    expect(markup).toContain("max-h-[60dvh]");
    expect(markup).toContain("[--sticky-top:0px]");
    expect(markup).not.toContain("md:overflow-visible");
    expect(markup).toContain("Loading observations...");
  });

  it("renders exact versions, outcome denominators, missing coverage and separate currencies", () => {
    const markup = renderPanel({ rows: [metric], status: "ready", nextCursor: "next-page" });
    expect(markup).toContain('data-version-id="version-3"');
    expect(markup).toContain("Release checklist");
    expect(markup).toContain(">v3<");
    expect(markup).toContain("50%");
    expect(markup).toContain("25%");
    expect(markup).toContain("partial coverage");
    expect(markup).toContain("$1.25");
    expect(markup).toContain("€0.500");
    expect(markup).toContain("Load more versions");
    expect(markup).toContain("not that the answer was right");
    expect(markup).not.toMatch(/thumb|rating|satisfaction/i);
  });

  it("does not display absent run logs as zero cost", () => {
    const markup = renderPanel({
      rows: [{ ...metric, runLogCount: 0, costs: [] }],
      status: "ready",
      nextCursor: "",
    });
    expect(markup).toContain("No run logs");
    expect(markup).not.toContain("$0");
  });

  it("renders empty and failed windows with distinct recovery states", () => {
    expect(renderPanel({ rows: [], status: "ready", nextCursor: "" })).toContain(
      "No invocations in this window.",
    );
    const failed = renderPanel({ rows: [], status: "failed", nextCursor: "" });
    expect(failed).toContain("Observations could not be loaded.");
    expect(failed).toContain("Try again");
    expect(failed).not.toContain("No invocations in this window.");
  });

  it("omits the skill link when embedded in its own detail page", () => {
    const markup = renderPanel({ rows: [metric], status: "ready", nextCursor: "" }, "skill-1");
    expect(markup).toContain(">v3<");
    expect(markup).not.toContain('href="/agents/skills/');
  });
});
