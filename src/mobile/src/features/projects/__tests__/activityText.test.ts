import { describe, expect, it } from "vitest";
import { describeActivity, type ActivityLookups } from "@features/projects/activityText";
import type { SerializedActivity } from "@features/projects/projectsSerializer";

const look: ActivityLookups = {
  optionLabel: (fieldId, id) =>
    ({ field_status: { status_done: "Done", status_todo: "To Do" }, f1: { o1: "Red" } })[
      fieldId as "field_status" | "f1"
    ]?.[id as never],
  fieldName: (id) => (id === "f1" ? "Colour" : undefined),
  personName: (id) => ({ u1: "Ana", u2: "Ben" })[id as "u1" | "u2"],
  taskLabel: (id) => (id === "t9" ? "#9 Login" : undefined),
  sprintName: (id) => (id === "s1" ? "Sprint 5" : undefined),
  typeLabel: (t) => (t === "bug" ? "Bug" : "Task"),
  date: (v) => `D(${v})`,
  minutes: (m) => `${m}m`,
};

function act(action: string, overrides: Partial<SerializedActivity> = {}): SerializedActivity {
  return { id: "a", taskId: "t", actorId: "u1", action, ...overrides };
}

describe("describeActivity", () => {
  it("names status options from and to", () => {
    expect(
      describeActivity(
        act("STATUS_CHANGED", { previousValue: "status_todo", newValue: "status_done" }),
        look,
      ),
    ).toEqual({ headline: "changed status", detail: "To Do -> Done" });
  });

  it("says who was assigned and unassigned", () => {
    expect(
      describeActivity(act("ASSIGNED", { previousValue: "u1", newValue: "u2" }), look).headline,
    ).toBe("assigned Ben and unassigned Ana");
  });

  it("formats dates, sprints, blockers and custom fields", () => {
    expect(describeActivity(act("DUE_DATE_CHANGED", { newValue: "2026-11-05" }), look)).toEqual({
      headline: "changed the due date",
      detail: "none -> D(2026-11-05)",
    });
    expect(describeActivity(act("SPRINT_CHANGED", { newValue: "s1" }), look).detail).toBe(
      "backlog -> Sprint 5",
    );
    expect(describeActivity(act("BLOCKED_BY_ADDED", { newValue: "t9" }), look).headline).toBe(
      "marked it blocked by #9 Login",
    );
    expect(describeActivity(act("FIELD_UPDATED", { fieldId: "f1", newValue: "o1" }), look)).toEqual(
      { headline: "changed Colour", detail: "none -> Red" },
    );
  });

  it("lists tag names and degrades on unknown actions", () => {
    expect(
      describeActivity(act("TAGS_CHANGED", { newValue: '["bug"]', previousValue: '["ui"]' }), look)
        .headline,
    ).toBe("added tags bug and removed tags ui");
    expect(describeActivity(act("SOMETHING_NEW"), look).headline).toBe("updated the task");
  });
});
