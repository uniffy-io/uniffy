import { describe, expect, it } from "vitest";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";
import { taskMatchesSearch } from "@/features/projects/utils/taskSearch";

const task = makeTask({
  id: "t1",
  number: 12,
  title: "Fix sync crash",
  description: "Reconnect drops the socket",
});

describe("taskMatchesSearch", () => {
  it("matches title and description without regard to case", () => {
    expect(taskMatchesSearch(task, "SYNC", "PROD")).toBe(true);
    expect(taskMatchesSearch(task, "socket", "PROD")).toBe(true);
  });

  it("matches the task number the way mobile does", () => {
    expect(taskMatchesSearch(task, "#12", "PROD")).toBe(true);
    expect(taskMatchesSearch(task, " #1 ", "PROD")).toBe(true);
    expect(taskMatchesSearch(task, "#13", "PROD")).toBe(false);
  });

  it("matches the project key shown in the views", () => {
    expect(taskMatchesSearch(task, "prod-12", "PROD")).toBe(true);
    expect(taskMatchesSearch(task, "PROD-12", undefined)).toBe(false);
  });

  it("keeps every task for a blank search", () => {
    expect(taskMatchesSearch(task, "   ", "PROD")).toBe(true);
  });

  it("drops tasks that match nothing", () => {
    expect(taskMatchesSearch(task, "roadmap", "PROD")).toBe(false);
  });
});
