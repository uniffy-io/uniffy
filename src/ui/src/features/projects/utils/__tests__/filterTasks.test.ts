import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FilterLogic,
  RelativeDateAnchor,
  TaskFilterOperator as Op,
  TaskPseudoField as Pseudo,
} from "@uniffy/proto/projects/v1/projects_pb";
import {
  DEFAULT_PRIORITY_OPTIONS,
  DEFAULT_STATUS_OPTIONS,
  SYSTEM_FIELD_IDS,
  type FieldDefinition,
} from "@/features/projects/types";
import type { Task } from "@/features/projects/types/project";
import type {
  ViewFieldRef,
  ViewFilterCondition,
  ViewFilterDate,
  ViewFilterGroup,
  ViewFilterValue,
} from "@/features/projects/types/views";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";
import {
  applyFilters,
  buildTaskHierarchyIndex,
  resolveFilterDate,
  type FilterContext,
} from "@/features/projects/utils/filterTasks";
import { fieldRef, pseudoRef } from "@/features/projects/utils/viewFields";
import { setPreferredTimeZone } from "@/shared/utils/timezone";

function field(id: string, type: FieldDefinition["type"], options = DEFAULT_STATUS_OPTIONS) {
  return {
    id,
    projectId: "proj-1",
    name: id,
    type,
    isRequired: false,
    isSystem: id.startsWith("field_"),
    sortOrder: 0,
    config: type === "single_select" || type === "multi_select" ? { options } : {},
    createdAt: "",
    updatedAt: "",
  } satisfies FieldDefinition;
}

const FIELDS: FieldDefinition[] = [
  field(SYSTEM_FIELD_IDS.TITLE, "text"),
  field(SYSTEM_FIELD_IDS.STATUS, "single_select"),
  field(SYSTEM_FIELD_IDS.PRIORITY, "single_select", DEFAULT_PRIORITY_OPTIONS),
  field(SYSTEM_FIELD_IDS.ASSIGNEE, "person"),
  field(SYSTEM_FIELD_IDS.DUE_DATE, "date"),
  field("points", "number"),
  field("link", "reference"),
];

/**
 *  epic (epic, sprint-1, due today)
 *  |- story (story, assigned to me, tagged red)
 *     |- task-a (blocked by loose, tagged red and blue, 5 points)
 *     |- task-b (done, assigned to someone else)
 *  loose (bug, no sprint, created 2026-09-01)
 */
function sampleTasks(): Task[] {
  return [
    makeTask({
      id: "epic",
      title: "Launch plan",
      taskType: "epic",
      sprintId: "sprint-1",
      dueDate: "2026-09-23",
      number: 1,
      createdAt: "2026-09-20T10:00:00Z",
    }),
    makeTask({
      id: "story",
      title: "Checkout story",
      taskType: "story",
      parentId: "epic",
      assigneeIds: ["user-me"],
      tagIds: ["red"],
      sprintId: "sprint-1",
      dueDate: "2026-09-26",
      number: 2,
      createdAt: "2026-09-21T10:00:00Z",
    }),
    makeTask({
      id: "task-a",
      title: "Wire payment form",
      parentId: "story",
      blockedByTaskIds: ["loose"],
      tagIds: ["red", "blue"],
      fieldValues: { points: 5 },
      sprintId: "sprint-2",
      number: 3,
      createdAt: "2026-09-22T23:30:00Z",
    }),
    makeTask({
      id: "task-b",
      title: "Write copy",
      parentId: "story",
      status: "status_done",
      completedAt: "2026-09-22T12:00:00Z",
      assigneeIds: ["user-other"],
      fieldValues: { points: 1, link: "urn:uniffy:content:NOTE:1" },
      number: 4,
      createdAt: "2026-09-22T09:00:00Z",
    }),
    makeTask({
      id: "loose",
      title: "Crash on login",
      taskType: "bug",
      isMilestone: true,
      number: 5,
      createdAt: "2026-09-01T08:00:00Z",
      ownerId: "user-me",
    }),
  ];
}

function context(tasks: Task[]): FilterContext {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return {
    hierarchy: buildTaskHierarchyIndex(tasks),
    fieldsById: new Map(FIELDS.map((f) => [f.id, f])),
    lookup: (id) => byId.get(id),
    currentUserId: "user-me",
    activeSprintId: "sprint-1",
    today: "2026-09-23",
    weekStartsOn: 1,
  };
}

function ids(values: string[], flags: Partial<Record<string, boolean>> = {}): ViewFilterValue {
  return {
    kind: "ids",
    ids: {
      ids: values,
      includeCurrentUser: flags.me ?? false,
      includeEmpty: flags.empty ?? false,
      includeActiveSprint: flags.activeSprint ?? false,
    },
  };
}

function when(ref: ViewFieldRef, operator: Op, value: ViewFilterValue | null = null) {
  return { field: ref, operator, value } satisfies ViewFilterCondition;
}

function all(...conditions: ViewFilterCondition[]): ViewFilterGroup {
  return {
    logic: FilterLogic.AND,
    nodes: conditions.map((condition) => ({ kind: "condition", condition })),
  };
}

function run(filter: ViewFilterGroup | null): string[] {
  const tasks = sampleTasks();
  return applyFilters(tasks, filter, context(tasks))
    .map((task) => task.id)
    .sort();
}

const status = fieldRef(SYSTEM_FIELD_IDS.STATUS);
const assignee = fieldRef(SYSTEM_FIELD_IDS.ASSIGNEE);
const due = fieldRef(SYSTEM_FIELD_IDS.DUE_DATE);
const title = fieldRef(SYSTEM_FIELD_IDS.TITLE);
const points = fieldRef("points");

/**
 * The conformance set for the view filter: every case names a condition and the tasks it keeps.
 * A server evaluator of the same definitions has to return the same ids for the same fixtures.
 */
const CASES: { name: string; filter: ViewFilterGroup; expected: string[] }[] = [
  {
    name: "single select is",
    filter: all(when(status, Op.IS, ids(["status_done"]))),
    expected: ["task-b"],
  },
  {
    name: "single select is not keeps tasks without the value",
    filter: all(when(status, Op.IS_NOT, ids(["status_todo"]))),
    expected: ["task-b"],
  },
  {
    name: "single select is any of",
    filter: all(when(status, Op.IS_ANY_OF, ids(["status_done", "status_todo"]))),
    expected: ["epic", "loose", "story", "task-a", "task-b"],
  },
  {
    name: "person is any of with the current user",
    filter: all(when(assignee, Op.IS_ANY_OF, ids([], { me: true }))),
    expected: ["story"],
  },
  {
    name: "person is none of keeps unassigned tasks",
    filter: all(when(assignee, Op.IS_NONE_OF, ids(["user-other"]))),
    expected: ["epic", "loose", "story", "task-a"],
  },
  {
    name: "person is any of with the empty flag",
    filter: all(when(assignee, Op.IS_ANY_OF, ids(["user-other"], { empty: true }))),
    expected: ["epic", "loose", "task-a", "task-b"],
  },
  {
    name: "person is empty",
    filter: all(when(assignee, Op.IS_EMPTY)),
    expected: ["epic", "loose", "task-a"],
  },
  {
    name: "tags is all of",
    filter: all(when(pseudoRef(Pseudo.TAGS), Op.IS_ALL_OF, ids(["red", "blue"]))),
    expected: ["task-a"],
  },
  {
    name: "tags is any of",
    filter: all(when(pseudoRef(Pseudo.TAGS), Op.IS_ANY_OF, ids(["red"]))),
    expected: ["story", "task-a"],
  },
  {
    name: "tags is none of",
    filter: all(when(pseudoRef(Pseudo.TAGS), Op.IS_NONE_OF, ids(["blue"]))),
    expected: ["epic", "loose", "story", "task-b"],
  },
  {
    name: "sprint is the active sprint",
    filter: all(when(pseudoRef(Pseudo.SPRINT), Op.IS, ids([], { activeSprint: true }))),
    expected: ["epic", "story"],
  },
  {
    name: "sprint is empty",
    filter: all(when(pseudoRef(Pseudo.SPRINT), Op.IS_EMPTY)),
    expected: ["loose", "task-b"],
  },
  {
    name: "task type is",
    filter: all(when(pseudoRef(Pseudo.TASK_TYPE), Op.IS, ids(["bug"]))),
    expected: ["loose"],
  },
  {
    name: "creator is the current user",
    filter: all(when(pseudoRef(Pseudo.CREATOR), Op.IS, ids([], { me: true }))),
    expected: ["loose"],
  },
  {
    name: "parent is",
    filter: all(when(pseudoRef(Pseudo.PARENT), Op.IS, ids(["story"]))),
    expected: ["task-a", "task-b"],
  },
  {
    name: "epic is: the epic and everything under it",
    filter: all(when(pseudoRef(Pseudo.EPIC), Op.IS, ids(["epic"]))),
    expected: ["epic", "story", "task-a", "task-b"],
  },
  {
    name: "epic is empty",
    filter: all(when(pseudoRef(Pseudo.EPIC), Op.IS_EMPTY)),
    expected: ["loose"],
  },
  {
    name: "depth is 0: top-level only",
    filter: all(when(pseudoRef(Pseudo.DEPTH), Op.IS, { kind: "number", number: 0 })),
    expected: ["epic", "loose"],
  },
  {
    name: "depth between 1 and 2",
    filter: all(when(pseudoRef(Pseudo.DEPTH), Op.BETWEEN, { kind: "numberRange", min: 1, max: 2 })),
    expected: ["story", "task-a", "task-b"],
  },
  {
    name: "has subtasks",
    filter: all(when(pseudoRef(Pseudo.HAS_SUBTASKS), Op.IS, { kind: "flag", flag: true })),
    expected: ["epic", "story"],
  },
  {
    name: "is blocked: incomplete with an open blocker",
    filter: all(when(pseudoRef(Pseudo.IS_BLOCKED), Op.IS, { kind: "flag", flag: true })),
    expected: ["task-a"],
  },
  {
    name: "blocked by is any of",
    filter: all(when(pseudoRef(Pseudo.BLOCKED_BY), Op.IS_ANY_OF, ids(["loose"]))),
    expected: ["task-a"],
  },
  {
    name: "milestone is no",
    filter: all(when(pseudoRef(Pseudo.IS_MILESTONE), Op.IS, { kind: "flag", flag: false })),
    expected: ["epic", "story", "task-a", "task-b"],
  },
  {
    name: "number greater than",
    filter: all(when(points, Op.GREATER_THAN, { kind: "number", number: 1 })),
    expected: ["task-a"],
  },
  {
    name: "number is not keeps tasks without a value",
    filter: all(when(points, Op.IS_NOT, { kind: "number", number: 5 })),
    expected: ["epic", "loose", "story", "task-b"],
  },
  {
    name: "number is empty",
    filter: all(when(points, Op.IS_EMPTY)),
    expected: ["epic", "loose", "story"],
  },
  {
    name: "task number less than",
    filter: all(when(pseudoRef(Pseudo.NUMBER), Op.LESS_THAN, { kind: "number", number: 3 })),
    expected: ["epic", "story"],
  },
  {
    name: "text contains ignores case",
    filter: all(when(title, Op.CONTAINS, { kind: "text", text: "PAYMENT" })),
    expected: ["task-a"],
  },
  {
    name: "text does not contain",
    filter: all(when(title, Op.NOT_CONTAINS, { kind: "text", text: "w" })),
    expected: ["epic", "loose", "story"],
  },
  {
    name: "text is matches the whole value",
    filter: all(when(title, Op.IS, { kind: "text", text: "write copy" })),
    expected: ["task-b"],
  },
  {
    name: "reference is not empty",
    filter: all(when(fieldRef("link"), Op.IS_NOT_EMPTY)),
    expected: ["task-b"],
  },
  {
    name: "date is today",
    filter: all(
      when(due, Op.IS, {
        kind: "date",
        date: { kind: "relative", anchor: RelativeDateAnchor.TODAY, offsetDays: 0 },
      }),
    ),
    expected: ["epic"],
  },
  {
    name: "date on or before the end of the week",
    filter: all(
      when(due, Op.ON_OR_BEFORE, {
        kind: "date",
        date: { kind: "relative", anchor: RelativeDateAnchor.END_OF_WEEK, offsetDays: 0 },
      }),
    ),
    expected: ["epic", "story"],
  },
  {
    name: "date after a fixed day; undated tasks never match",
    filter: all(when(due, Op.AFTER, { kind: "date", date: { kind: "fixed", date: "2026-09-23" } })),
    expected: ["story"],
  },
  {
    name: "timestamp between two fixed days, by calendar day in the viewer's zone",
    filter: all(
      when(pseudoRef(Pseudo.CREATED_AT), Op.BETWEEN, {
        kind: "dateRange",
        start: { kind: "fixed", date: "2026-09-21" },
        end: { kind: "fixed", date: "2026-09-22" },
      }),
    ),
    expected: ["story", "task-a", "task-b"],
  },
  {
    name: "completed at is not empty",
    filter: all(when(pseudoRef(Pseudo.COMPLETED_AT), Op.IS_NOT_EMPTY)),
    expected: ["task-b"],
  },
  {
    name: "conditions under AND all hold",
    filter: all(
      when(pseudoRef(Pseudo.EPIC), Op.IS, ids(["epic"])),
      when(pseudoRef(Pseudo.DEPTH), Op.IS, { kind: "number", number: 1 }),
    ),
    expected: ["story"],
  },
  {
    name: "one condition under OR is enough",
    filter: {
      logic: FilterLogic.OR,
      nodes: [
        { kind: "condition", condition: when(pseudoRef(Pseudo.TASK_TYPE), Op.IS, ids(["bug"])) },
        { kind: "condition", condition: when(status, Op.IS, ids(["status_done"])) },
      ],
    },
    expected: ["loose", "task-b"],
  },
  {
    name: "a nested OR group inside AND",
    filter: {
      logic: FilterLogic.AND,
      nodes: [
        { kind: "condition", condition: when(pseudoRef(Pseudo.EPIC), Op.IS, ids(["epic"])) },
        {
          kind: "group",
          group: {
            logic: FilterLogic.OR,
            nodes: [
              { kind: "condition", condition: when(status, Op.IS, ids(["status_done"])) },
              { kind: "condition", condition: when(assignee, Op.IS_ANY_OF, ids(["user-me"])) },
            ],
          },
        },
      ],
    },
    expected: ["story", "task-b"],
  },
  {
    name: "a condition on a deleted field matches nothing",
    filter: all(when(fieldRef("gone"), Op.IS_NOT_EMPTY)),
    expected: [],
  },
];

describe("applyFilters conformance", () => {
  beforeAll(() => setPreferredTimeZone("UTC"));
  afterAll(() => setPreferredTimeZone(null));

  it.each(CASES)("$name", ({ filter, expected }) => {
    expect(run(filter)).toEqual(expected);
  });

  it("keeps every task without a filter or with an empty group", () => {
    expect(run(null)).toHaveLength(5);
    expect(run({ logic: FilterLogic.AND, nodes: [] })).toHaveLength(5);
  });

  it("reads a timestamp on the viewer's calendar day", () => {
    setPreferredTimeZone("Europe/Sofia");
    try {
      // 23:30 UTC on the 22nd is already the 23rd in Sofia.
      const filter = all(
        when(pseudoRef(Pseudo.CREATED_AT), Op.IS, {
          kind: "date",
          date: { kind: "fixed", date: "2026-09-23" },
        }),
      );
      expect(run(filter)).toEqual(["task-a"]);
    } finally {
      setPreferredTimeZone("UTC");
    }
  });
});

describe("resolveFilterDate", () => {
  const ctx = { today: "2026-09-23", weekStartsOn: 1 as const };
  const relative = (anchor: RelativeDateAnchor, offsetDays = 0): ViewFilterDate => ({
    kind: "relative",
    anchor,
    offsetDays,
  });

  it("anchors weeks on the preferred first day", () => {
    const start = relative(RelativeDateAnchor.START_OF_WEEK);
    expect(resolveFilterDate(start, ctx)).toBe("2026-09-21");
    expect(resolveFilterDate(start, { ...ctx, weekStartsOn: 0 })).toBe("2026-09-20");
  });

  it("resolves month ends and offsets", () => {
    expect(resolveFilterDate(relative(RelativeDateAnchor.END_OF_MONTH, 1), ctx)).toBe("2026-10-01");
    expect(resolveFilterDate(relative(RelativeDateAnchor.START_OF_MONTH, -1), ctx)).toBe(
      "2026-08-31",
    );
  });
});

describe("buildTaskHierarchyIndex", () => {
  it("computes depth and ancestors", () => {
    const index = buildTaskHierarchyIndex(sampleTasks());
    expect(index.depthById.get("epic")).toBe(0);
    expect(index.depthById.get("task-a")).toBe(2);
    expect([...(index.ancestorIdsById.get("task-a") ?? [])].sort()).toEqual(["epic", "story"]);
    expect(index.hasChildren.has("story")).toBe(true);
    expect(index.hasChildren.has("loose")).toBe(false);
  });

  it("tolerates a cyclic parent_id chain without spinning", () => {
    const tasks = [makeTask({ id: "a", parentId: "b" }), makeTask({ id: "b", parentId: "a" })];
    const index = buildTaskHierarchyIndex(tasks);
    expect(index.depthById.get("a")).toBeLessThan(64);
    expect(index.depthById.get("b")).toBeLessThan(64);
  });
});
