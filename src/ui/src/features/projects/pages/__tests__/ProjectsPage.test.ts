import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";
import type { TaskDetail } from "@/features/projects/hooks/useTaskDetail";
import { ProjectsPage } from "@/features/projects/pages/ProjectsPage";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { emitContentAccessChanged } from "@/features/notifications/contentAccessEmitter";

const fixture = vi.hoisted(() => ({
  params: {} as { taskId?: string; projectId?: string },
  location: { pathname: "/projects/project", search: "", state: null },
  state: null as unknown as RootState,
  detail: null as unknown as TaskDetail,
  effects: [] as Array<() => void | (() => void)>,
  dispatch: vi.fn(),
  navigate: vi.fn(),
  loadDetail: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void | (() => void)) => fixture.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("react-router-dom", () => ({
  useParams: () => fixture.params,
  useLocation: () => fixture.location,
  useNavigate: () => fixture.navigate,
  useSearchParams: () => [new URLSearchParams(fixture.location.search), vi.fn()],
}));
vi.mock("@/app/hooks", () => ({
  useAppSelector: (select: (state: RootState) => unknown) => select(fixture.state),
  useAppDispatch: () => fixture.dispatch,
}));
vi.mock("@/features/projects/hooks/useTaskDetail", () => ({
  useTaskDetail: (taskId: string) => {
    fixture.loadDetail(taskId);
    return fixture.detail;
  },
}));
vi.mock("@/features/projects/components/layout/ProjectsLayout", () => ({
  ProjectsLayout: () => null,
}));
vi.mock("@/features/projects/components/detail/TaskPageContent", () => ({
  TaskPageContent: () => null,
}));
vi.mock("@/components/layout/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/features/settings", () => ({ useShortcutHandlers: () => {} }));
vi.mock("@/features/settings/hooks/useSettings", () => ({
  useAppearanceSettings: () => ({ taskOpenView: "panel" }),
}));
vi.mock("@/shared/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

let cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fixture.params = { projectId: "project" };
  fixture.location = { pathname: "/projects/project", search: "", state: null };
  fixture.effects = [];
  fixture.state = {
    settings: { initialized: true },
    projects: {
      currentProjectId: "project",
      projects: { project: { id: "project", name: "Project" } },
    },
  } as unknown as RootState;
  fixture.detail = {
    task: { id: "task", projectId: "project", title: "Task", number: 1 },
    project: { id: "project", slug: "PRJ" },
    loadFailed: false,
    retry: vi.fn(),
  } as unknown as TaskDetail;
});

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  vi.useRealTimers();
});

describe("project and task routes", () => {
  it.each(["panel", "modal"])("keeps workspace identity when opening and closing %s", (view) => {
    const project = ProjectsPage({});
    fixture.params = { taskId: "task" };
    fixture.location = { pathname: "/projects/task/task", search: `?view=${view}`, state: null };
    const opened = ProjectsPage({});
    expect(opened.type).toBe(project.type);
    expect(opened.props.children.type).toBe(project.props.children.type);
    expect(opened.props.children.props.taskDetail).toBe(fixture.detail);
    expect(opened.props.children.props.taskRoute).toEqual({
      projectId: "project",
      taskId: "task",
      view,
    });
    expect(fixture.loadDetail.mock.calls).toEqual([[""], ["task"]]);
    fixture.params = { projectId: "project" };
    fixture.location = { pathname: "/projects/project", search: "", state: null };
    const closed = ProjectsPage({});
    expect(closed.props.children.type).toBe(opened.props.children.type);
    expect(closed.props.children.props.taskRoute).toBeUndefined();
  });

  it.each(["revoked", "granted", "access_mode_changed"] as const)(
    "revalidates full-page task and project list when parent access is %s",
    (action) => {
      fixture.params = { taskId: "task" };
      fixture.location = { pathname: "/projects/task/task", search: "?view=page", state: null };
      const page = ProjectsPage({});
      expect(page.props.children.props.detail).toBe(fixture.detail);
      cleanups = fixture.effects.flatMap((effect) => {
        const cleanup = effect();
        return cleanup ? [cleanup] : [];
      });
      emitContentAccessChanged({ contentType: ContentType.PROJECT, contentId: "project", action });
      vi.advanceTimersByTime(500);
      expect(fixture.detail.retry).toHaveBeenCalledOnce();
      expect(fixture.dispatch).toHaveBeenCalledOnce();
    },
  );

  it("refreshes project list without refetching a task in another project", () => {
    fixture.params = { taskId: "task" };
    fixture.location.search = "?view=page";
    ProjectsPage({});
    cleanups = fixture.effects.flatMap((effect) => {
      const cleanup = effect();
      return cleanup ? [cleanup] : [];
    });
    emitContentAccessChanged({
      contentType: ContentType.PROJECT,
      contentId: "other",
      action: "revoked",
    });
    vi.advanceTimersByTime(500);
    expect(fixture.detail.retry).not.toHaveBeenCalled();
    expect(fixture.dispatch).toHaveBeenCalledOnce();
  });
});
