import { expect, it, vi } from "vitest";
import { timeApi } from "@/features/projects/api/timeApi";

const fixture = vi.hoisted(() => ({ listTaskWorklogs: vi.fn() }));
vi.mock("@/config/api", () => ({ unaryTransport: {} }));
vi.mock("@/features/calendar/api/calendarApi", () => ({ calendarApi: {} }));
vi.mock("@connectrpc/connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@connectrpc/connect")>()),
  createClient: () => fixture,
}));

it("returns a task-history page without following its continuation token", async () => {
  fixture.listTaskWorklogs.mockResolvedValue({ worklogs: [], nextPageToken: "100" });
  expect(await timeApi.listTaskWorklogs("task", "org", "50")).toEqual({
    worklogs: [],
    nextPageToken: "100",
  });
  expect(fixture.listTaskWorklogs).toHaveBeenCalledExactlyOnceWith({
    organizationId: "org",
    taskId: "task",
    pageSize: 50,
    pageToken: "50",
  });
});
