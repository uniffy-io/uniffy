import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ExportTasksModal } from "@/features/projects/components/modals/ExportTasksModal";

const hooks = vi.hoisted(() => ({
  dispatch: vi.fn(async (request: unknown) => request),
  exportTasks: Object.assign(vi.fn((request: unknown) => request), {
    fulfilled: { match: () => true },
  }),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock("@/app/hooks", () => ({ useAppDispatch: () => hooks.dispatch }));
vi.mock("@/features/projects/store/projectsThunks", () => ({
  exportProjectTasks: hooks.exportTasks,
}));

type Element = ReactElement<Record<string, unknown>>;

function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as ReactNode)];
  });
}

beforeEach(() => vi.clearAllMocks());

it.each([
  { allowCurrentView: undefined, viewBlockedReason: null, expected: "project" },
  { allowCurrentView: true, viewBlockedReason: null, expected: "view" },
  { allowCurrentView: true, viewBlockedReason: "Field deleted", expected: "project" },
])("uses $expected scope", async (options) => {
  const tree = elements(
    ExportTasksModal({
      projectIds: ["project"],
      onClose: vi.fn(),
      allowCurrentView: options.allowCurrentView,
      viewBlockedReason: options.viewBlockedReason,
    }),
  );
  const currentView = tree.find((element) => element.props.label === "Current view");
  expect(Boolean(currentView)).toBe(Boolean(options.allowCurrentView));
  const submit = tree.find((element) => element.props.children === "Export")!;

  await (submit.props.onClick as () => Promise<void>)();

  expect(hooks.exportTasks).toHaveBeenCalledWith({
    projectIds: ["project"],
    scope: options.expected,
    includeBundle: false,
  });
});
