import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { expect, it } from "vitest";
import { ViewVisibility } from "@uniffy/proto/projects/v1/projects_pb";
import type { Project, ViewConfig } from "@/features/projects/types";
import { ViewTabs } from "@/features/projects/components/header/ViewTabs";
import { emptyDefinition } from "@/features/projects/utils/viewDraft";

function renderTabs(canEdit: boolean, canManage: boolean, visibility = ViewVisibility.SHARED) {
  const view: ViewConfig = {
    id: "table",
    projectId: "p",
    name: "Table",
    type: "table",
    definition: emptyDefinition("table"),
    ownerId: "me",
    visibility,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  };
  const store = configureStore({ reducer: { auth: () => ({ user: { id: "me" } }) } });
  return renderToStaticMarkup(
    createElement(Provider, {
      store,
      children: createElement(ViewTabs, {
        project: { id: "p", defaultViewId: view.id } as Project,
        views: [view],
        activeViewId: view.id,
        dirtyViewIds: [],
        showActiveLabel: true,
        compact: false,
        canEdit,
        canManage,
      }),
    }),
  );
}

it.each([
  ["viewer", false, false, ViewVisibility.SHARED],
  ["editor", true, false, ViewVisibility.SHARED],
  ["admin", true, true, ViewVisibility.SHARED],
  ["personal owner", false, false, ViewVisibility.PERSONAL],
] as const)("keeps %s tabs accessible and sortable", (_role, canEdit, canManage, visibility) => {
  const markup = renderTabs(canEdit, canManage, visibility);
  expect(markup).toContain('role="tab"');
  expect(markup).toContain('aria-label="Table options"');
  expect(markup).toContain('aria-roledescription="sortable"');
  expect(markup).toContain('tabindex="0"');
  expect(markup.match(/aria-disabled="true"/g)).toBeNull();
});
