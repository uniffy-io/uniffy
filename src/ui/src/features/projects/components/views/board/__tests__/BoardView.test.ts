import { beforeEach, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import type { ViewGroupBy } from "@/features/projects/types/views";
import { SortDirection } from "@uniffy/proto/projects/v1/projects_pb";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";
import {
  SYSTEM_FIELD_IDS,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_PRIORITY_OPTIONS,
} from "@/features/projects/types";
import { fieldRef } from "@/features/projects/utils/viewFields";
import {
  buildLaneCardId,
  buildLaneDropId,
} from "@/features/projects/components/views/board/boardDropIds";
import { BoardView } from "@/features/projects/components/views/board/BoardView";
import { groupTasks } from "@/features/projects/utils/groupTasks";
import { buildTaskHierarchyIndex } from "@/features/projects/utils/filterTasks";
import type { GroupContext, TaskGroup } from "@/features/projects/utils/groupTasks";
import type { FieldDefinition, Task } from "@/features/projects/types";

const state = vi.hoisted(() => ({
  selections: [] as unknown[],
  tasks: [] as Task[],
  groups: null as TaskGroup[] | null,
  dispatch: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useMemo: (fn: () => unknown) => fn(),
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [typeof value === "function" ? value() : value, vi.fn()],
}));
vi.mock("@/app/hooks", () => ({
  useAppSelector: () => state.selections.shift(),
  useAppDispatch: () => state.dispatch,
}));
vi.mock("@dnd-kit/core", () => ({
  DndContext: "dnd-context",
  DragOverlay: "drag-overlay",
  closestCorners: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(),
}));
vi.mock("@dnd-kit/sortable", () => ({ sortableKeyboardCoordinates: vi.fn() }));
vi.mock("@/features/projects/store/projectsSlice", () => ({
  selectCurrentProject: vi.fn(),
  optimisticUpdateTask: (payload: unknown) => ({ type: "optimistic", payload }),
  updateFieldDefinition: vi.fn(),
}));
vi.mock("@/features/projects/store/sprintsSlice", () => ({
  selectActiveSprint: vi.fn(),
  selectSprintsForProject: vi.fn(),
}));
vi.mock("@/features/projects/store/projectsThunks", () => ({
  moveTask: (payload: unknown) => ({ type: "move", payload }),
  updateTask: (payload: unknown) => ({ type: "update", payload }),
  updateFieldThunk: vi.fn(),
}));
vi.mock("@/features/projects/store/projectsUiSlice", () => ({
  selectSearchQuery: vi.fn(),
  selectTask: vi.fn(),
  openDetailPanel: vi.fn(),
  openCreateTaskModal: vi.fn(),
}));
vi.mock("@/features/projects/hooks/useTasks", () => ({ useFilteredTasks: () => state.tasks }));
vi.mock("@/features/projects/hooks/useTaskGroups", () => ({
  useTaskGroups: () => ({ groups: state.groups, ctx: { lookup: vi.fn() } }),
}));
vi.mock("@/features/projects/store/viewSelectors", () => ({ selectActiveDefinition: vi.fn() }));
vi.mock("@/features/projects/store/viewDraftThunks", () => ({
  toggleDraftCollapsedGroup: vi.fn(),
}));
vi.mock("@/features/projects/hooks/useProjectPermissions", () => ({
  useProjectPermission: () => ({ canEdit: true }),
}));
vi.mock("@/features/projects/components/views/board/BoardColumn", () => ({
  BoardColumn: "board-column",
}));
vi.mock("@/features/projects/components/views/board/BoardSwimlane", () => ({
  BoardSwimlane: "board-swimlane",
  SwimlaneColumnHeaderRow: "column-headers",
}));
vi.mock("@/features/projects/components/views/board/TaskCard", () => ({ TaskCard: "task-card" }));
vi.mock("@/features/projects/components/views/board/AddStatusDialog", () => ({
  AddStatusDialog: "add-status",
}));
vi.mock("@/features/projects/components/views/table/EmptyState", () => ({
  EmptyState: "empty-state",
}));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));

const fields: FieldDefinition[] = [
  {
    id: SYSTEM_FIELD_IDS.STATUS,
    name: "Status",
    type: "single_select",
    config: { options: DEFAULT_STATUS_OPTIONS },
  },
  {
    id: SYSTEM_FIELD_IDS.PRIORITY,
    name: "Priority",
    type: "single_select",
    config: { options: DEFAULT_PRIORITY_OPTIONS },
  },
  { id: SYSTEM_FIELD_IDS.ASSIGNEE, name: "Assignee", type: "person", config: {} },
] as FieldDefinition[];

beforeEach(() => state.dispatch.mockClear());

function board(
  task: Task,
  groupField: string | null,
  columnField = SYSTEM_FIELD_IDS.STATUS as string,
  definitions = fields,
) {
  const groupBy: ViewGroupBy | null = groupField
    ? { field: fieldRef(groupField), direction: SortDirection.ASC, hideEmpty: false }
    : null;
  const ctx: GroupContext = {
    fieldsById: new Map(definitions.map((field) => [field.id, field])),
    hierarchy: buildTaskHierarchyIndex([task]),
    lookup: (id) => (id === task.id ? task : undefined),
    currentUserId: null,
    activeSprintId: null,
    today: "2026-09-26",
    weekStartsOn: 1,
    epics: [],
    sprints: [],
    nameOf: () => undefined,
    tagOf: () => undefined,
  };
  state.tasks = [task];
  state.groups = groupBy ? groupTasks([task], groupBy, ctx) : null;
  state.selections = [
    { id: "project", fieldDefinitions: definitions, slug: "PRJ" },
    "",
    { groupBy, layout: { type: "board", columnFieldId: columnField }, collapsedGroupKeys: [] },
    null,
    [],
  ];
  const root = BoardView()!;
  return root.props.children[1] as ReactElement<{
    onDragEnd: (event: DragEndEvent) => void;
    children: ReactNode;
  }>;
}

function drop(
  dnd: ReturnType<typeof board>,
  taskId: string,
  sourceLane: string,
  destLane: string,
  destColumn: string,
) {
  dnd.props.onDragEnd({
    active: { id: buildLaneCardId(sourceLane, taskId) },
    over: { id: buildLaneDropId(destLane, destColumn) },
  } as DragEndEvent);
}

it("updates status and assignee together in one request", () => {
  const task = makeTask({ id: "task", status: "status_todo", assigneeIds: ["amy", "zoe"] });
  const dnd = board(task, SYSTEM_FIELD_IDS.ASSIGNEE);
  drop(dnd, task.id, "amy", "zoe", "status_done");
  expect(state.dispatch.mock.calls.map(([action]) => action)).toEqual([
    {
      type: "optimistic",
      payload: { id: task.id, status: "status_done", sortOrder: 0, assigneeIds: ["zoe"] },
    },
    {
      type: "update",
      payload: { id: task.id, status: "status_done", sortOrder: 0, assigneeIds: ["zoe"] },
    },
  ]);
});

it("rejects impossible destinations when both axes use one field", () => {
  const task = makeTask({ id: "task", priority: "priority_high" });
  const dnd = board(task, SYSTEM_FIELD_IDS.PRIORITY, SYSTEM_FIELD_IDS.PRIORITY);
  drop(dnd, task.id, "priority_high", "priority_high", "priority_low");
  expect(state.dispatch).not.toHaveBeenCalled();
});

it("allows matching destinations when both axes use one field", () => {
  const task = makeTask({ id: "task", priority: "priority_high" });
  const dnd = board(task, SYSTEM_FIELD_IDS.PRIORITY, SYSTEM_FIELD_IDS.PRIORITY);
  drop(dnd, task.id, "priority_high", "priority_low", "priority_low");
  expect(state.dispatch.mock.calls[1][0]).toEqual({
    type: "update",
    payload: { id: task.id, priority: "priority_low" },
  });
});

it.each(["constructor", "toString", "__proto__"])(
  "renders column option %s without prototype collisions",
  (id) => {
    const task = makeTask({ id: "task", priority: id });
    const definitions = fields.map((field) =>
      field.id === SYSTEM_FIELD_IDS.PRIORITY
        ? { ...field, config: { options: [{ id, label: id, color: "", sortOrder: 0 }] } }
        : field,
    );
    const dnd = board(task, null, SYSTEM_FIELD_IDS.PRIORITY, definitions);
    const column = columnsIn(dnd)[0];
    expect(column.props.tasks).toEqual([task]);
  },
);

function columnsIn(node: ReactNode): ReactElement<{ tasks: Task[] }>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode; tasks: Task[] }>(child)) return [];
    if (child.type === "board-column") return [child];
    return columnsIn(child.props.children);
  });
}
