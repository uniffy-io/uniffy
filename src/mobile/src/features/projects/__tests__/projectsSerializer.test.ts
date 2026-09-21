import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { FieldDefinitionSchema, ProjectSchema } from "@uniffy/proto/projects/v1/projects_pb";
import {
  buildFieldConfigJson,
  projectToPlain,
  STATUS_FIELD_ID,
  type SerializedFieldDefinition,
} from "@features/projects/projectsSerializer";

const STORED_OPTIONS = [
  { id: "status_todo", label: "To Do", color: "#694aff", sortOrder: 0, semantic: "todo" },
  {
    id: "status_doing",
    label: "Doing",
    color: "#8c56fa",
    sortOrder: 1,
    semantic: "in_progress",
    wip: 3,
  },
  { id: "status_shipped", label: "Shipped", color: "#d16ef0", sortOrder: 2, semantic: "completed" },
  { id: "status_parked", label: "Parked", color: "", sortOrder: 3, semantic: "paused" },
];

function statusField(): SerializedFieldDefinition {
  const project = projectToPlain(
    create(ProjectSchema, {
      id: "proj-1",
      fieldDefinitions: [
        create(FieldDefinitionSchema, {
          id: STATUS_FIELD_ID,
          name: "Status",
          configJson: JSON.stringify({ options: STORED_OPTIONS, allowMultiple: false }),
        }),
      ],
    }),
  );
  return project.fieldDefinitions[0];
}

describe("status field options", () => {
  it("keep a known semantic and drop an unknown one when parsed", () => {
    expect(statusField().options.map((o) => o.semantic)).toEqual([
      "todo",
      "in_progress",
      "completed",
      undefined,
    ]);
  });

  it("keep semantics and unmodelled keys through a reorder and rename", () => {
    const field = statusField();
    const [todo, doing, shipped, parked] = field.options;
    const edited = [
      { ...shipped, label: "Released", sortOrder: 0 },
      { ...todo, sortOrder: 1 },
      { ...doing, color: "", sortOrder: 2 },
      { ...parked, sortOrder: 3 },
    ];
    const config = JSON.parse(buildFieldConfigJson(field, edited));

    expect(config.allowMultiple).toBe(false);
    expect(config.options).toEqual([
      { ...STORED_OPTIONS[2], label: "Released", sortOrder: 0 },
      { ...STORED_OPTIONS[0], sortOrder: 1 },
      { ...STORED_OPTIONS[1], color: "", sortOrder: 2 },
      { ...STORED_OPTIONS[3], sortOrder: 3 },
    ]);
  });

  it("write a new option with only the keys it was given", () => {
    const field = statusField();
    const added = { id: "status_new", label: "New", color: "", sortOrder: 4 };
    const config = JSON.parse(buildFieldConfigJson(field, [...field.options, added]));
    expect(config.options[4]).toEqual(added);
  });
});
