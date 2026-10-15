import { describe, expect, it } from "vitest";
import { create, toJson } from "@bufbuild/protobuf";
import { UpdateTaskRequestSchema } from "@uniffy/proto/projects/v1/projects_pb";
import { UpdateEventRequestSchema } from "@uniffy/proto/cal/v1/calendar_pb";
import { descriptionPatch } from "./descriptionPatch";

describe.each([
  ["task", UpdateTaskRequestSchema],
  ["event", UpdateEventRequestSchema],
] as const)("%s description save", (_name, schema) => {
  it("omits stale unchanged text during a metadata save", () => {
    const patch = descriptionPatch("opening text", "opening text");
    const request = create(schema, { title: "New title", ...patch });
    expect(toJson(schema, request)).toEqual({ title: "New title" });
  });

  it("carries exact original text when editing", () => {
    const patch = descriptionPatch(" original \n", " changed \n");
    const request = create(schema, patch);
    expect(toJson(schema, request)).toEqual({
      baseDescription: " original \n",
      description: " changed \n",
    });
  });

  it("preserves presence when clearing or starting from empty text", () => {
    expect(toJson(schema, create(schema, descriptionPatch("base", "")))).toEqual({
      baseDescription: "base",
      description: "",
    });
    expect(toJson(schema, create(schema, descriptionPatch("", "new")))).toEqual({
      baseDescription: "",
      description: "new",
    });
  });
});
