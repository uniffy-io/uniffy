import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";
import { initialTimeState } from "@/features/projects/store/timeSlice";
import { LogTimeModal } from "@/features/projects/components/time/LogTimeModal";
import { WorklogSection } from "@/features/projects/components/time/WorklogSection";
import type { Task } from "@/features/projects/types";
import type { Timer, Worklog } from "@/features/projects/types/time";

const fixture = vi.hoisted(() => ({ state: null as unknown as RootState }));
vi.mock("@/app/hooks", () => ({
  useAppSelector: (select: (state: RootState) => unknown) => select(fixture.state),
  useAppDispatch: () => vi.fn(),
}));
vi.mock("@/features/settings/hooks/useSettings", () => ({
  useSchedulingSettings: () => ({ workdays: [1, 2, 3, 4, 5] }),
}));
vi.mock("@/shared/utils/timezone", () => ({
  getEffectiveTimeZone: () => "UTC",
  getPreferredTimeZone: () => "UTC",
}));
vi.mock("@/components/ui/modal", () => ({
  Modal: ({ children }: { children: ReactNode }) => createElement("div", {}, children),
  ModalBody: ({ children }: { children: ReactNode }) => createElement("div", {}, children),
  ModalFooter: ({ children }: { children: ReactNode }) => createElement("div", {}, children),
  ModalHeader: () => null,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("@/components/subject", () => ({ SubjectAvatarById: () => null }));
vi.mock("@/components/subject/hooks/useSubjectResolver", () => ({
  useSubjectResolver: () => ({ subjects: [] }),
}));

beforeEach(() => {
  fixture.state = { time: initialTimeState, auth: { user: { id: "person" } } } as RootState;
});

describe("time forms", () => {
  it("keeps duration editable while hiding unsupported timer clock controls", () => {
    const timer = {
      startedAt: "2026-10-19T09:00:00Z",
      accumulatedSeconds: 600,
      description: "",
    } as Timer;
    const html = renderToStaticMarkup(
      createElement(LogTimeModal, {
        task: { id: "task", title: "Task" },
        timer,
        onClose: () => {},
      }),
    );
    expect(html).toContain('data-testid="log-time-duration"');
    expect(html).not.toContain('aria-label="Start time"');
    expect(html).not.toContain('aria-label="End time"');
    expect(html).not.toContain("Clear the clock times");
  });

  it("retains clock controls for manual entries", () => {
    const html = renderToStaticMarkup(
      createElement(LogTimeModal, { task: { id: "task", title: "Task" }, onClose: () => {} }),
    );
    expect(html).toContain('aria-label="Start time"');
    expect(html).toContain('aria-label="End time"');
  });

  it("bounds mounted task history even when many pages are cached", () => {
    const entries = Array.from(
      { length: 10_000 },
      (_, i) =>
        ({
          id: `entry-${i}`,
          taskId: "task",
          userId: "person",
          workDate: "2026-10-19",
          startedAt: null,
          durationMinutes: 1,
          description: "",
          source: "manual",
        }) as Worklog,
    );
    fixture.state = {
      ...fixture.state,
      time: {
        ...initialTimeState,
        worklogsByTask: { task: entries },
        taskPageTokens: { task: "10000" },
      },
    };
    const html = renderToStaticMarkup(
      createElement(WorklogSection, {
        task: { id: "task", title: "Task", timeSpentMinutes: 10_000 } as Task,
      }),
    );
    expect(html.match(/data-testid="worklog-row"/g)).toHaveLength(50);
    expect(html).toContain("Older entries");
    expect(html).toContain("166h 40m");
  });

  it("offers another page without treating loaded minutes as the total", () => {
    const entry = {
      id: "entry",
      taskId: "task",
      userId: "person",
      workDate: "2026-10-19",
      startedAt: null,
      durationMinutes: 30,
      description: "",
      source: "manual",
    } as Worklog;
    fixture.state = {
      ...fixture.state,
      time: {
        ...initialTimeState,
        worklogsByTask: { task: [entry] },
        taskPageTokens: { task: "50" },
      },
    };
    const html = renderToStaticMarkup(
      createElement(WorklogSection, {
        task: { id: "task", title: "Task", timeSpentMinutes: 600 } as Task,
      }),
    );
    expect(html).toContain("Load more");
    expect(html).toContain("10h");
  });
});
