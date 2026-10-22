import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { OrganizationList } from "@/features/auth/components/OrganizationList";
import type { OrganizationSummary } from "@/features/auth/store/organizationsSlice";

type ListProps = Parameters<typeof OrganizationList>[0];
type ButtonProps = {
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  "aria-current"?: string;
  "aria-disabled"?: string;
  "aria-busy"?: string;
};

function organization(
  id: string,
  name: string,
  overrides: Partial<OrganizationSummary> = {},
): OrganizationSummary {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    role: OrganizationRole.MEMBER,
    suspended: false,
    joinedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const ORGANIZATIONS = [
  organization("org-acme", "Acme", { role: OrganizationRole.OWNER }),
  organization("org-globex", "Globex", { role: OrganizationRole.ADMIN }),
  organization("org-initech", "Initech", { suspended: true }),
];

function props(overrides: Partial<ListProps> = {}): ListProps {
  return {
    organizations: ORGANIZATIONS,
    currentOrganizationId: "org-acme",
    switchingSlug: null,
    onSelect: () => {},
    ...overrides,
  };
}

function render(overrides: Partial<ListProps> = {}): string {
  return renderToStaticMarkup(createElement(OrganizationList, props(overrides)));
}

/** The opening tag and body of the row button whose title is the organization name. */
function rowMarkup(html: string, name: string): string {
  const row = html.split("<button").find((part) => part.includes(`title="${name}"`));
  if (!row) throw new Error(`no row for ${name}`);
  return row.slice(0, row.indexOf("</button>"));
}

/** Row buttons as rendered, expanding the list's own function components. */
function rowButtons(node: ReactNode): ReactElement<ButtonProps>[] {
  if (Array.isArray(node)) return node.flatMap(rowButtons);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  if (typeof node.type === "function") {
    const component = node.type as (props: unknown) => ReactNode;
    return rowButtons(component(node.props));
  }
  if (node.type === "button") return [node as ReactElement<ButtonProps>];
  return rowButtons(node.props.children);
}

function buttonFor(name: string, overrides: Partial<ListProps> = {}): ReactElement<ButtonProps> {
  const button = rowButtons(createElement(OrganizationList, props(overrides))).find(
    (candidate) => candidate.props.title === name,
  );
  if (!button) throw new Error(`no button for ${name}`);
  return button;
}

describe("OrganizationList", () => {
  it("marks only the current organization with aria-current", () => {
    const html = render();

    expect(rowMarkup(html, "Acme")).toContain('aria-current="true"');
    expect(rowMarkup(html, "Globex")).not.toContain("aria-current");
    expect(rowMarkup(html, "Initech")).not.toContain("aria-current");
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("disables suspended rows without a click handler", () => {
    const html = render();

    expect(rowMarkup(html, "Initech")).toContain('aria-disabled="true"');
    expect(rowMarkup(html, "Initech")).toContain(">Suspended<");
    expect(rowMarkup(html, "Globex")).not.toContain("aria-disabled");
    expect(buttonFor("Initech").props.onClick).toBeUndefined();
  });

  it("selects an active row by its slug", () => {
    const onSelect = vi.fn();

    buttonFor("Globex", { onSelect }).props.onClick?.();

    expect(onSelect).toHaveBeenCalledWith("globex");
  });

  it.each([false, true])("renders every role label (compact %s)", (compact) => {
    const html = render({
      compact,
      organizations: ORGANIZATIONS.map((item) => ({ ...item, suspended: false })),
    });

    expect(rowMarkup(html, "Acme")).toContain(">Owner<");
    expect(rowMarkup(html, "Globex")).toContain(">Admin<");
    expect(rowMarkup(html, "Initech")).toContain(">Member<");
  });

  it("shows progress on the switching row and holds the others", () => {
    const html = render({ switchingSlug: "globex" });

    expect(rowMarkup(html, "Globex")).toContain('aria-busy="true"');
    expect(rowMarkup(html, "Globex")).toContain("animate-spin");
    expect(rowMarkup(html, "Acme")).not.toContain("animate-spin");
    expect(buttonFor("Acme", { switchingSlug: "globex" }).props.disabled).toBe(true);
  });

  it("holds every active row while other work is about to switch the tab", () => {
    expect(buttonFor("Acme", { disabled: true }).props.disabled).toBe(true);
    expect(buttonFor("Globex", { disabled: true }).props.disabled).toBe(true);
    expect(rowMarkup(render({ disabled: true }), "Globex")).not.toContain("animate-spin");
    expect(buttonFor("Globex").props.disabled).toBe(false);
  });

  it("types every row as a plain button", () => {
    const html = render();

    expect(html.match(/<button/g)).toHaveLength(ORGANIZATIONS.length);
    expect(html.match(/type="button"/g)).toHaveLength(ORGANIZATIONS.length);
  });
});
