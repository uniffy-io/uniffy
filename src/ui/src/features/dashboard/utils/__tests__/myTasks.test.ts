import { afterEach, describe, expect, it } from "vitest";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { setPreferredTimeZone } from "@/shared/utils/timezone";
import { categorizeMyTasks } from "@/features/dashboard/utils/myTasks";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";

const ME = "user-me";
const TODAY = "2026-09-17";

function ids(tasks: { id: string }[]): string[] {
  return tasks.map((task) => task.id);
}

describe("categorizeMyTasks", () => {
  afterEach(() => setPreferredTimeZone(null));

  it("buckets open tasks assigned to the caller by calendar day", () => {
    const groups = categorizeMyTasks(
      [
        makeTask({ id: "late", assigneeIds: [ME], dueDate: "2026-09-12" }),
        makeTask({ id: "today", assigneeIds: [ME], dueDate: TODAY }),
        makeTask({ id: "soon", assigneeIds: [ME], dueDate: "2026-09-20" }),
        makeTask({ id: "undated", assigneeIds: [ME] }),
      ],
      ME,
      TODAY,
    );

    expect(ids(groups.overdue)).toEqual(["late"]);
    expect(ids(groups.dueToday)).toEqual(["today"]);
    expect(ids(groups.upcoming)).toEqual(["soon", "undated"]);
  });

  it("skips completed, deleted and other people's tasks", () => {
    const groups = categorizeMyTasks(
      [
        makeTask({
          id: "done",
          assigneeIds: [ME],
          dueDate: "2026-09-01",
          completedAt: "2026-09-02T10:00:00Z",
        }),
        makeTask({
          id: "deleted",
          assigneeIds: [ME],
          dueDate: "2026-09-01",
          deletedAt: "2026-09-02T10:00:00Z",
        }),
        makeTask({ id: "theirs", assigneeIds: ["someone-else"], dueDate: "2026-09-01" }),
        makeTask({ id: "shared", assigneeIds: ["someone-else", ME], dueDate: "2026-09-01" }),
      ],
      ME,
      TODAY,
    );

    expect(ids(groups.overdue)).toEqual(["shared"]);
    expect(groups.dueToday).toEqual([]);
    expect(groups.upcoming).toEqual([]);
  });

  it("orders overdue and upcoming by due date, and undated tasks by last update", () => {
    const groups = categorizeMyTasks(
      [
        makeTask({ id: "newer-late", assigneeIds: [ME], dueDate: "2026-09-15" }),
        makeTask({ id: "older-late", assigneeIds: [ME], dueDate: "2026-08-30" }),
        makeTask({ id: "later", assigneeIds: [ME], dueDate: "2026-10-01" }),
        makeTask({ id: "stale", assigneeIds: [ME], updatedAt: "2026-09-01T08:00:00Z" }),
        makeTask({ id: "fresh", assigneeIds: [ME], updatedAt: "2026-09-16T08:00:00Z" }),
        makeTask({ id: "sooner", assigneeIds: [ME], dueDate: "2026-09-18" }),
      ],
      ME,
      TODAY,
    );

    expect(ids(groups.overdue)).toEqual(["older-late", "newer-late"]);
    expect(ids(groups.upcoming)).toEqual(["sooner", "later", "fresh", "stale"]);
  });

  it("keeps a task due today out of overdue late in the evening west of UTC", () => {
    setPreferredTimeZone("America/New_York");
    // 23:30 on Sep 17 in New York is already Sep 18 in UTC.
    const todayInNewYork = effectiveDayKey(new Date("2026-09-18T03:30:00Z"));
    expect(todayInNewYork).toBe(TODAY);

    const groups = categorizeMyTasks(
      [makeTask({ id: "today", assigneeIds: [ME], dueDate: TODAY })],
      ME,
      todayInNewYork,
    );

    expect(groups.overdue).toEqual([]);
    expect(ids(groups.dueToday)).toEqual(["today"]);
  });

  it("reads a timestamp due date on the effective zone's calendar", () => {
    setPreferredTimeZone("Pacific/Auckland");
    // 20:00 UTC on Sep 16 is 08:00 on Sep 17 in Auckland.
    const groups = categorizeMyTasks(
      [makeTask({ id: "stamped", assigneeIds: [ME], dueDate: "2026-09-16T20:00:00Z" })],
      ME,
      TODAY,
    );

    expect(ids(groups.dueToday)).toEqual(["stamped"]);
  });
});
