import { describe, expect, it } from "vitest";
import { TaskPseudoField } from "@uniffy/proto/projects/v1/projects_pb";
import {
  HIERARCHY_DEPTH_FIELD_ID,
  HIERARCHY_ROOT_ONLY_FIELD_ID,
  TAGS_FILTER_FIELD_ID,
  TASK_ATTRIBUTE_FILTER_FIELDS,
  TASK_ATTRIBUTE_PSEUDO_FIELDS,
  taskAttributeFilterField,
} from "@/features/projects/utils/taskAttributeFields";

describe("task attribute filter fields", () => {
  it("binds every toolbar attribute to a backend catalog entry", () => {
    for (const attribute of TASK_ATTRIBUTE_FILTER_FIELDS) {
      expect(TaskPseudoField[attribute.pseudo]).toBeDefined();
      expect(attribute.pseudo).not.toBe(TaskPseudoField.UNSPECIFIED);
    }
  });

  it("reads the same attribute back by its filter id", () => {
    expect(taskAttributeFilterField(TAGS_FILTER_FIELD_ID)?.pseudo).toBe(TaskPseudoField.TAGS);
    expect(taskAttributeFilterField("field_status")).toBeNull();
  });

  it("maps root-only and depth onto the one depth attribute", () => {
    expect(taskAttributeFilterField(HIERARCHY_ROOT_ONLY_FIELD_ID)?.pseudo).toBe(
      TaskPseudoField.DEPTH,
    );
    expect(taskAttributeFilterField(HIERARCHY_DEPTH_FIELD_ID)?.pseudo).toBe(TaskPseudoField.DEPTH);
  });

  it("offers one condition-row field per attribute, tags first", () => {
    expect(TASK_ATTRIBUTE_PSEUDO_FIELDS.map((f) => f.id)).toEqual(
      TASK_ATTRIBUTE_FILTER_FIELDS.map((a) => a.id),
    );
    expect(TASK_ATTRIBUTE_PSEUDO_FIELDS.every((f) => f.isSystem && f.projectId === "")).toBe(true);
    expect(TASK_ATTRIBUTE_PSEUDO_FIELDS[0].sortOrder).toBeLessThan(
      TASK_ATTRIBUTE_PSEUDO_FIELDS[1].sortOrder,
    );
  });
});
