import { describe, expect, it } from "vitest";
import { ViewVisibility } from "@uniffy/proto/projects/v1/projects_pb";
import type { ViewConfig } from "@/features/projects/types/views";
import { emptyDefinition } from "@/features/projects/utils/viewDraft";
import { viewGates } from "@/features/projects/utils/viewGates";
import { nextViewParamStep } from "@/features/projects/utils/viewLinks";

function view(visibility: ViewVisibility, ownerId = "owner"): ViewConfig {
  return {
    id: "v",
    projectId: "p",
    name: "v",
    type: "table",
    definition: emptyDefinition("table"),
    ownerId,
    visibility,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  };
}

const VIEWER = { canEdit: false, canManage: false };
const EDITOR = { canEdit: true, canManage: false };
const ADMIN = { canEdit: true, canManage: true };

describe("viewGates", () => {
  it("gives a viewer only their own personal views", () => {
    const own = viewGates(view(ViewVisibility.PERSONAL, "me"), {
      ...VIEWER,
      currentUserId: "me",
      isDefault: false,
    });
    expect(own).toEqual({
      canEdit: true,
      canReorder: true,
      canSetDefault: false,
      canMakeShared: false,
      canMakePersonal: false,
    });
    const shared = viewGates(view(ViewVisibility.SHARED), {
      ...VIEWER,
      currentUserId: "me",
      isDefault: false,
    });
    expect(Object.values(shared).some(Boolean)).toBe(false);
  });

  it("lets an editor change and share views but not order them or pick the default", () => {
    const shared = viewGates(view(ViewVisibility.SHARED), {
      ...EDITOR,
      currentUserId: "me",
      isDefault: false,
    });
    expect(shared).toMatchObject({ canEdit: true, canReorder: false, canSetDefault: false });
    const own = viewGates(view(ViewVisibility.PERSONAL, "me"), {
      ...EDITOR,
      currentUserId: "me",
      isDefault: false,
    });
    expect(own.canMakeShared).toBe(true);
  });

  it("lets an admin order shared views and pick any shared view but the current default", () => {
    const ctx = { ...ADMIN, currentUserId: "me" };
    expect(viewGates(view(ViewVisibility.SHARED), { ...ctx, isDefault: false })).toMatchObject({
      canReorder: true,
      canSetDefault: true,
    });
    expect(viewGates(view(ViewVisibility.SHARED), { ...ctx, isDefault: true }).canSetDefault).toBe(
      false,
    );
  });

  it("only the owner makes a shared view personal, and never the default one", () => {
    const ctx = { ...ADMIN, currentUserId: "me" };
    expect(
      viewGates(view(ViewVisibility.SHARED, "me"), { ...ctx, isDefault: false }),
    ).toMatchObject({ canMakePersonal: true });
    expect(viewGates(view(ViewVisibility.SHARED, "me"), { ...ctx, isDefault: true })).toMatchObject(
      {
        canMakePersonal: false,
      },
    );
    expect(viewGates(view(ViewVisibility.SHARED), { ...ctx, isDefault: false })).toMatchObject({
      canMakePersonal: false,
    });
  });
});

describe("nextViewParamStep", () => {
  const viewIds = ["table", "board", "mine"];

  it("opens the same view id when navigating to another project", () => {
    expect(
      nextViewParamStep({
        projectId: "b",
        param: "board",
        settled: { projectId: "a", param: "board" },
        activeViewId: "table",
        viewIds,
      }),
    ).toEqual({
      step: { kind: "open", viewId: "board" },
      settled: { projectId: "b", param: "board" },
    });
  });

  it("opens a deep-linked view the caller can see", () => {
    expect(
      nextViewParamStep({
        projectId: "p",
        param: "board",
        settled: null,
        activeViewId: "table",
        viewIds,
      }),
    ).toEqual({
      step: { kind: "open", viewId: "board" },
      settled: { projectId: "p", param: "board" },
    });
  });

  it("replaces an unknown or someone else's view with the open one", () => {
    expect(
      nextViewParamStep({
        projectId: "p",
        param: "theirs",
        settled: null,
        activeViewId: "table",
        viewIds,
      }),
    ).toEqual({
      step: { kind: "write", viewId: "table" },
      settled: { projectId: "p", param: "table" },
    });
  });

  it("writes the view the caller opened", () => {
    expect(
      nextViewParamStep({
        projectId: "p",
        param: "table",
        settled: { projectId: "p", param: "table" },
        activeViewId: "board",
        viewIds,
      }),
    ).toEqual({
      step: { kind: "write", viewId: "board" },
      settled: { projectId: "p", param: "board" },
    });
  });

  it("adds the parameter to a project link without one", () => {
    expect(
      nextViewParamStep({
        projectId: "p",
        param: null,
        settled: { projectId: "p", param: "board" },
        activeViewId: "table",
        viewIds,
      }),
    ).toEqual({
      step: { kind: "write", viewId: "table" },
      settled: { projectId: "p", param: "table" },
    });
  });

  it("follows the URL on back and forward", () => {
    expect(
      nextViewParamStep({
        projectId: "p",
        param: "mine",
        settled: { projectId: "p", param: "board" },
        activeViewId: "board",
        viewIds,
      }),
    ).toEqual({
      step: { kind: "open", viewId: "mine" },
      settled: { projectId: "p", param: "mine" },
    });
  });

  it("settles once the URL and the open view agree", () => {
    expect(
      nextViewParamStep({
        projectId: "p",
        param: "board",
        settled: { projectId: "p", param: "board" },
        activeViewId: "board",
        viewIds,
      }),
    ).toEqual({ step: { kind: "none" }, settled: { projectId: "p", param: "board" } });
  });
});
