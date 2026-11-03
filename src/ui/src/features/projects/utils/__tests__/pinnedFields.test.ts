import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_PINNED_FIELDS,
  MAX_PINNED_TASK_FIELDS,
  normalizePinnedFields,
  togglePinnedField,
} from "@/features/projects/utils/pinnedFields";

describe("normalizePinnedFields", () => {
  it("falls back to the default set when the preference is unset", () => {
    expect(normalizePinnedFields(undefined)).toEqual(DEFAULT_TASK_PINNED_FIELDS);
  });

  it("keeps an explicit empty choice", () => {
    expect(normalizePinnedFields([])).toEqual([]);
  });

  it("skips unknown ids and duplicates, keeping order", () => {
    expect(normalizePinnedFields(["tags", "story_points", "status", "tags"])).toEqual([
      "tags",
      "status",
    ]);
  });

  it("stops at the limit", () => {
    const many = ["status", "priority", "assignees", "due_date", "start_date", "tags", "type"];
    expect(normalizePinnedFields(many)).toHaveLength(MAX_PINNED_TASK_FIELDS);
  });
});

describe("togglePinnedField", () => {
  it("unpins a pinned field and appends a new one", () => {
    expect(togglePinnedField(["status", "priority"], "status")).toEqual(["priority"]);
    expect(togglePinnedField(["status"], "tags")).toEqual(["status", "tags"]);
  });

  it("does not grow past the limit", () => {
    const full = normalizePinnedFields([
      "status",
      "priority",
      "assignees",
      "due_date",
      "start_date",
      "tags",
    ]);
    expect(togglePinnedField(full, "sprint")).toEqual(full);
  });
});
