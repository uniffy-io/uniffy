import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GeneralSection } from "@/features/projects/components/settings/GeneralSection";
import type { Project } from "@/features/projects/types";

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  deps: new Map<number, readonly unknown[]>(),
  effects: [] as (() => void)[],
  dispatch: vi.fn(() => ({ unwrap: () => Promise.resolve() })),
  updateProject: vi.fn((request: unknown) => request),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.values[index] = value;
      },
    ];
  },
  useRef: (current: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current };
    return hooks.values[index];
  },
  useEffect: (effect: () => void, deps: readonly unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.deps.get(index);
    if (!previous || deps.some((value, i) => !Object.is(value, previous[i])))
      hooks.effects.push(effect);
    hooks.deps.set(index, deps);
  },
}));
vi.mock("@/app/hooks", () => ({ useAppDispatch: () => hooks.dispatch }));
vi.mock("@/features/projects/store/projectsThunks", () => ({ updateProject: hooks.updateProject }));
vi.mock("@/features/tags", () => ({ TagPicker: "tag-picker" }));

type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as ReactNode)];
  });
}

function render(project: Project): Element[] {
  hooks.cursor = 0;
  const tree = GeneralSection({ project });
  const effects = hooks.effects.splice(0);
  for (const effect of effects) effect();
  return effects.length ? render(project) : elements(tree);
}

const project = {
  id: "p",
  name: "Original",
  description: "",
  slug: "PROJ",
  icon: "kanban",
  tagIds: ["tag-a"],
} as Project;
const nameField = (fields: Element[]) =>
  fields.find((field) => field.props.placeholder === "e.g. Product Launch Q2")!;
const picker = (fields: Element[]) => fields.find((field) => field.type === "tag-picker")!;
function editName(fields: Element[], value: string) {
  (nameField(fields).props.onChange as (event: { target: { value: string } }) => void)({
    target: { value },
  });
}
function editTags(fields: Element[], ids: string[]) {
  (picker(fields).props.onChange as (ids: string[]) => void)(ids);
}

beforeEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
  hooks.deps.clear();
  hooks.effects = [];
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it("keeps unsaved text and tags across an equivalent project refresh", () => {
  const fields = render(project);
  editName(fields, "Unsaved name");
  editTags(fields, ["tag-a", "tag-b"]);
  const refreshed = render({ ...project, tagIds: [...project.tagIds] });
  expect(nameField(refreshed).props.value).toBe("Unsaved name");
  expect(picker(refreshed).props.selectedTagIds).toEqual(["tag-a", "tag-b"]);
});

it("keeps drafts when only the saved tag order changes", () => {
  const original = { ...project, tagIds: ["tag-a", "tag-b"] };
  editName(render(original), "Unsaved name");
  expect(nameField(render({ ...original, tagIds: ["tag-b", "tag-a"] })).props.value).toBe(
    "Unsaved name",
  );
});

it("loads actual server changes and switches projects", () => {
  editName(render(project), "Unsaved name");
  const changed = { ...project, tagIds: ["tag-c"] };
  const fields = render(changed);
  expect(nameField(fields).props.value).toBe("Original");
  expect(picker(fields).props.selectedTagIds).toEqual(["tag-c"]);
  editName(fields, "Another draft");
  expect(nameField(render({ ...changed, id: "another-project" })).props.value).toBe("Original");
});

it("waits for a pending tag and saves the IDs returned by the picker", async () => {
  let fields = render(project);
  (picker(fields).props.onPendingChange as (pending: boolean) => void)(true);
  fields = render(project);
  let finish!: (ids: string[]) => void;
  const commit = vi.fn(
    () =>
      new Promise<string[]>((resolve) => {
        finish = resolve;
      }),
  );
  (picker(fields).props.ref as { current: unknown }).current = { commit };
  const button = fields.find((field) => field.props.type === "submit")!;
  expect(button.props.disabled).toBe(false);
  const submit = fields.find((field) => field.type === "form")!.props.onSubmit as (event: {
    preventDefault: () => void;
  }) => Promise<void>;
  const pending = submit({ preventDefault: vi.fn() });
  expect(hooks.updateProject).not.toHaveBeenCalled();
  finish(["tag-a", "tag-b"]);
  await pending;
  expect(hooks.updateProject).toHaveBeenCalledWith(
    expect.objectContaining({ id: "p", tagIds: ["tag-a", "tag-b"] }),
  );
});

it("does not save the project when tag creation fails", async () => {
  editName(render(project), "Unsaved name");
  const fields = render(project);
  (picker(fields).props.ref as { current: unknown }).current = {
    commit: () => Promise.resolve(null),
  };
  const submit = fields.find((field) => field.type === "form")!.props.onSubmit as (event: {
    preventDefault: () => void;
  }) => Promise<void>;
  await submit({ preventDefault: vi.fn() });
  expect(hooks.updateProject).not.toHaveBeenCalled();
  expect(nameField(render(project)).props.value).toBe("Unsaved name");
});
