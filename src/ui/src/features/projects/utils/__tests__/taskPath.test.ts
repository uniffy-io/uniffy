import { describe, expect, it } from "vitest";
import {
  parseTaskOpenView,
  taskLinkPath,
  taskProjectPath,
} from "@/features/projects/utils/taskPath";

describe("task links", () => {
  it("shares task identity without a presentation or project view", () => {
    expect(taskLinkPath("task-id")).toBe("/projects/task/task-id");
  });

  it.each(["panel", "modal", "page"] as const)(
    "keeps %s separate from saved project view",
    (view) => {
      const url = new URL(taskLinkPath("task-id", view, "board&id"), "https://uniffy.test");
      expect(url.searchParams.get("view")).toBe(view);
      expect(url.searchParams.get("projectView")).toBe("board&id");
      const project = new URL(
        taskProjectPath("project-id", url.searchParams.get("projectView")),
        url,
      );
      expect(project.pathname).toBe("/projects/project-id");
      expect(project.searchParams.get("view")).toBe("board&id");
      expect(project.searchParams.has("projectView")).toBe(false);
    },
  );

  it.each([null, undefined, "", "sidebar", "saved-view-id", "PAGE", {}])(
    "rejects unknown view %s",
    (value) => {
      expect(parseTaskOpenView(value)).toBeUndefined();
    },
  );
});
