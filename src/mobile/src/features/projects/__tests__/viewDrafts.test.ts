import { create } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it } from "vitest";
import { SortDirection, ViewDefinitionSchema } from "@uniffy/proto/projects/v1/projects_pb";
import {
  beginViewSave,
  editViewDraft,
  finishViewSave,
  getViewDraft,
  isViewSaving,
  setViewDraft,
} from "@features/projects/viewDrafts";
import { fieldRef } from "@features/projects/viewDefinition";

const scope = { userId: "user", organizationId: "org", projectId: "project" };
const saved = create(ViewDefinitionSchema, { layout: { case: "table", value: {} } });
const ascending = create(ViewDefinitionSchema, {
  layout: saved.layout,
  sort: [{ field: fieldRef("field_title"), direction: SortDirection.ASC }],
});
const descending = create(ViewDefinitionSchema, {
  layout: saved.layout,
  sort: [{ field: fieldRef("field_title"), direction: SortDirection.DESC }],
});

beforeEach(() => setViewDraft(scope, "view", null));

describe("view save drafts", () => {
  it("keeps changes made during save and save-as", () => {
    editViewDraft(scope, "view", ascending, saved);
    const pending = beginViewSave(scope, "view", ascending)!;
    editViewDraft(scope, "view", descending, saved);
    finishViewSave(pending, true);
    expect(getViewDraft(scope, "view")).toBe(descending);
  });

  it("retains a return to the saved definition while a different save is pending", () => {
    editViewDraft(scope, "view", ascending, saved);
    const pending = beginViewSave(scope, "view", ascending)!;
    editViewDraft(scope, "view", saved, saved);
    finishViewSave(pending, true);
    expect(getViewDraft(scope, "view")).toBe(saved);
  });

  it("clears an unchanged successful draft but retains a failed one", () => {
    editViewDraft(scope, "view", ascending, saved);
    finishViewSave(beginViewSave(scope, "view", ascending)!, false);
    expect(getViewDraft(scope, "view")).toBe(ascending);
    finishViewSave(beginViewSave(scope, "view", ascending)!, true);
    expect(getViewDraft(scope, "view")).toBeUndefined();
  });

  it("prevents simultaneous saves of the same view", () => {
    const pending = beginViewSave(scope, "view", ascending)!;
    expect(beginViewSave(scope, "view", descending)).toBeNull();
    expect(isViewSaving(scope, "view")).toBe(true);
    finishViewSave(pending, false);
    expect(isViewSaving(scope, "view")).toBe(false);
  });

  it("clears reverted edits when no save is pending", () => {
    editViewDraft(scope, "view", ascending, saved);
    editViewDraft(scope, "view", saved, saved);
    expect(getViewDraft(scope, "view")).toBeUndefined();
  });
});
