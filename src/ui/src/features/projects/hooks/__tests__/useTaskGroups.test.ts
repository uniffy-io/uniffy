import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RootState } from "@/app/store";
import { SortDirection } from "@uniffy/proto/projects/v1/projects_pb";
import { useTaskGroups } from "@/features/projects/hooks/useTaskGroups";
import { GroupHeaderLabel } from "@/features/projects/components/views/GroupHeaderLabel";
import { fieldRef } from "@/features/projects/utils/viewFields";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";
import { buildTaskHierarchyIndex, type FilterContext } from "@/features/projects/utils/filterTasks";
import { SYSTEM_FIELD_IDS, type Task, type FieldDefinition } from "@/features/projects/types";
import type { Subject } from "@/components/subject/types";

const fixture = vi.hoisted(() => ({
  state: null as unknown as RootState,
  reads: 0,
  tasks: [] as Task[],
  context: null as unknown as FilterContext,
}));
vi.mock("@/app/hooks", () => ({
  useAppSelector: (select: (state: RootState) => unknown) => select(fixture.state),
  useAppDispatch: () => vi.fn(),
}));
vi.mock("@/features/projects/hooks/useTasks", () => ({
  useTaskFilterContext: () => fixture.context,
}));
vi.mock("@/features/projects/store/projectsSlice", () => ({
  selectTasksForProject: () => () => fixture.tasks,
}));
vi.mock("@/features/projects/store/sprintsSlice", () => ({
  selectSprintsForProject: () => () => [],
}));
vi.mock("@/features/admin/store/adminThunks", () => ({
  DIRECTORY_MEMBERS_PAGE_SIZE: 500,
  fetchMembers: vi.fn(),
  fetchGroups: vi.fn(),
}));
vi.mock("@/components/subject", () => ({
  SubjectAvatar: ({ subject }: { subject: Subject }) =>
    createElement("span", { "data-avatar": subject.id }),
}));
vi.mock("@/features/projects/components/TaskTypeIcon", () => ({ TaskTypeIcon: () => null }));

function Headers() {
  const { groups } = useTaskGroups("project", fixture.tasks, {
    field: fieldRef(SYSTEM_FIELD_IDS.ASSIGNEE),
    direction: SortDirection.ASC,
    hideEmpty: true,
  });
  return groups?.map((group) => createElement(GroupHeaderLabel, { key: group.key, group }));
}

it.each([20, 200, 500])(
  "indexes directory once for %i person headers and preserves avatars",
  (count) => {
    fixture.tasks = Array.from({ length: count }, (_, i) =>
      makeTask({ id: `task-${i}`, assigneeIds: [`person-${i}`] }),
    );
    const members = fixture.tasks.map((_, i) => ({
      get userId() {
        fixture.reads++;
        return `person-${i}`;
      },
      displayName: `Person ${i}`,
      email: "",
    }));
    fixture.state = {
      auth: { currentOrganizationId: "org" },
      admin: {
        members,
        membersFetched: true,
        membersLoading: false,
        groups: [],
        groupsFetched: true,
        groupsLoading: false,
      },
      agents: { agents: {} },
      tags: { byId: {} },
    } as unknown as RootState;
    const field = {
      id: SYSTEM_FIELD_IDS.ASSIGNEE,
      name: "Assignee",
      type: "person",
      config: {},
    } as FieldDefinition;
    fixture.context = {
      fieldsById: new Map([[field.id, field]]),
      hierarchy: buildTaskHierarchyIndex(fixture.tasks),
      lookup: (id) => fixture.tasks.find((task) => task.id === id),
      currentUserId: null,
      activeSprintId: null,
      today: "2026-09-26",
      weekStartsOn: 1,
    };
    fixture.reads = 0;
    const html = renderToStaticMarkup(createElement(Headers));
    expect(fixture.reads).toBe(count * 2);
    expect(html.match(/data-avatar=/g)).toHaveLength(count);
    expect(html).toContain(`Person ${count - 1}`);
  },
);
