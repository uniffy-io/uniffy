import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { beforeEach, expect, it, vi } from "vitest";
import {
  FilterLogic,
  TaskFilterOperator,
  ViewVisibility,
} from "@uniffy/proto/projects/v1/projects_pb";
import type { RootState } from "@/app/store";
import type { Project, FieldDefinition } from "@/features/projects/types";
import { projectsReducer } from "@/features/projects/store/projectsSlice";
import { projectsUiReducer } from "@/features/projects/store/projectsUiSlice";
import { sprintsReducer } from "@/features/projects/store/sprintsSlice";
import { selectDraftSort } from "@/features/projects/store/viewSelectors";
import { emptyDefinition } from "@/features/projects/utils/viewDraft";
import { fieldRef } from "@/features/projects/utils/viewFields";
import { TableView } from "@/features/projects/components/views/table/TableView";
import { FilterBuilder } from "@/features/projects/components/views/table/FilterBuilder";

const harness = vi.hoisted(() => ({ state: () => ({}), dispatch: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (build: () => unknown) => build(),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  useEffect: () => {},
}));
vi.mock("@/app/hooks", () => ({
  useAppDispatch: () => harness.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) => selector(harness.state()),
}));
vi.mock("@dnd-kit/core", async (original) => ({
  ...(await original<typeof import("@dnd-kit/core")>()),
  useSensor: () => ({}),
  useSensors: () => [],
}));
vi.mock("@/features/projects/hooks/useProjectPermissions", () => ({
  useProjectPermission: () => ({ canEdit: true }),
}));
vi.mock("@/features/projects/hooks/useTasks", () => ({
  useFilteredTasks: () => [{ id: "task-1", parentId: null, number: 1, sortOrder: 0 }],
}));
vi.mock("@/components/subject/hooks/useSubjectResolver", () => ({
  useSubjectResolver: () => ({ subjects: [] }),
}));

const fields = [
  { id: "field_title", name: "Title", type: "text", config: {} },
  { id: "labels", name: "Labels", type: "multi_select", config: {} },
  { id: "reference", name: "Reference", type: "reference", config: {} },
] as FieldDefinition[];

const reducer = combineReducers({
  projects: projectsReducer,
  projectsUi: projectsUiReducer,
  sprints: sprintsReducer,
  tags: () => ({ byId: {} }),
});
function makeStore() {
  const initial = reducer(undefined, { type: "init" });
  return configureStore({
    reducer,
    preloadedState: {
      ...initial,
      projects: {
        ...initial.projects,
        currentProjectId: "p",
        projects: {
          p: {
            id: "p",
            fieldDefinitions: fields,
            defaultViewId: "table",
            views: [
              {
                id: "table",
                projectId: "p",
                name: "Table",
                type: "table",
                ownerId: "u",
                visibility: ViewVisibility.PERSONAL,
                sortOrder: 0,
                createdAt: "",
                updatedAt: "",
                definition: emptyDefinition("table"),
              },
            ],
          } as Project,
        },
      },
    },
  });
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as ReactNode)];
  });
}

beforeEach(() => {
  const store = makeStore();
  harness.state = store.getState;
  harness.dispatch = vi.fn(store.dispatch);
});

it("ignores unsupported column clicks and still sorts Title", () => {
  const headers = elements(TableView()).filter(
    (element) => element.type === "div" && element.props.onClick,
  );
  for (const label of ["Tags", "Labels", "Reference", "Title"]) {
    const header = headers.find((element) =>
      elements(element.props.children as ReactNode).some((child) => child.props.children === label),
    );
    expect(header, label).toBeDefined();
    (header!.props.onClick as (event: { shiftKey: boolean }) => void)({ shiftKey: false });
    expect(String(header!.props.className).includes("cursor-pointer")).toBe(label === "Title");
    expect(selectDraftSort("p")(harness.state() as RootState).map((key) => key.field)).toEqual(
      label === "Title" ? [fieldRef("field_title")] : [],
    );
  }
});

it("offers Title as a saved filter field", () => {
  const tree = FilterBuilder({
    projectId: "p",
    fields,
    onApply: vi.fn(),
    onClose: vi.fn(),
    filter: {
      logic: FilterLogic.AND,
      nodes: [
        {
          kind: "condition",
          condition: {
            field: fieldRef("field_title"),
            operator: TaskFilterOperator.CONTAINS,
            value: { kind: "text", text: "login" },
          },
        },
      ],
    },
  });
  const row = elements(tree).find((element) => element.props.fieldChoices);
  expect(row?.props.fieldChoices).toContainEqual({ value: "field:field_title", label: "Title" });
});
