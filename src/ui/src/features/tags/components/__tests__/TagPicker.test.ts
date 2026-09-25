import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TagPicker, type TagPickerHandle } from "@/features/tags/components/TagPicker";

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  deps: new Map<number, readonly unknown[]>(),
  effects: [] as (() => void)[],
  cleanups: new Map<number, () => void>(),
  create: vi.fn<() => Promise<unknown>>(),
  dispatch: vi.fn<(action: { type: string }) => Promise<unknown>>(),
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
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.deps.get(index);
    if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
      hooks.effects.push(() => {
        hooks.cleanups.get(index)?.();
        const cleanup = effect();
        if (cleanup) hooks.cleanups.set(index, cleanup);
      });
    }
    hooks.deps.set(index, deps);
  },
  useMemo: (build: () => unknown) => build(),
  useCallback: (callback: unknown) => callback,
  useImperativeHandle: (ref: { current: unknown }, build: () => unknown) => {
    ref.current = build();
  },
}));
vi.mock("@/app/hooks", () => ({ useAppDispatch: () => hooks.dispatch }));
vi.mock("@/features/tags/store/selectors", () => ({ useTagsByIds: () => [] }));
vi.mock("@/features/tags/store/tagsThunks", () => ({
  createTagThunk: Object.assign((input: unknown) => ({ type: "create", input }), {
    fulfilled: { match: (action: { type: string }) => action.type === "created" },
  }),
  suggestTagsThunk: Object.assign(() => ({ type: "suggest" }), {
    fulfilled: { match: (action: { type: string }) => action.type === "suggested" },
  }),
}));

type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as ReactNode)];
  });
}

const selectedTagIds = ["tag-a"];
const ref = { current: null as TagPickerHandle | null };
const onChange = vi.fn();
const onPendingChange = vi.fn();
function render(): Element[] {
  hooks.cursor = 0;
  const tree = TagPicker({ ref, selectedTagIds, onChange, onPendingChange, autoFocus: true });
  const effects = hooks.effects.splice(0);
  for (const effect of effects) effect();
  return effects.length ? render() : elements(tree);
}
function typeTag(value: string): Element[] {
  const input = render().find((element) => element.type === "input")!;
  (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  return render();
}

beforeEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
  hooks.deps.clear();
  hooks.effects = [];
  hooks.cleanups.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  hooks.dispatch.mockImplementation((action) =>
    action.type === "create" ? hooks.create() : Promise.resolve({ type: "ignored" }),
  );
});
afterEach(() => {
  for (const cleanup of hooks.cleanups.values()) cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("coalesces blur and form commit into one tag creation and returns its IDs", async () => {
  let finish!: (value: unknown) => void;
  hooks.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const fields = typeTag("New tag");
  expect(onPendingChange).toHaveBeenLastCalledWith(true);
  (fields.find((element) => element.type === "input")!.props.onBlur as () => void)();
  const pending = ref.current!.commit();
  expect(ref.current!.commit()).toBe(pending);
  await vi.advanceTimersByTimeAsync(300);
  expect(hooks.create).toHaveBeenCalledTimes(1);
  finish({ type: "created", payload: { id: "tag-b", name: "New tag", slug: "new-tag" } });
  await expect(pending).resolves.toEqual(["tag-a", "tag-b"]);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(["tag-a", "tag-b"]);
  render();
  expect(onPendingChange).toHaveBeenLastCalledWith(false);
});

it("retains failed tag input for retry and reports failure to the form", async () => {
  hooks.create
    .mockResolvedValueOnce({ type: "rejected" })
    .mockResolvedValueOnce({ type: "created", payload: { id: "tag-b" } });
  typeTag("New tag");
  await expect(ref.current!.commit()).resolves.toBeNull();
  const fields = render();
  expect(fields.find((element) => element.type === "input")!.props.value).toBe("New tag");
  expect(onChange).not.toHaveBeenCalled();
  await expect(ref.current!.commit()).resolves.toEqual(["tag-a", "tag-b"]);
});

it("ignores late creation after the picker unmounts", async () => {
  let finish!: (value: unknown) => void;
  hooks.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  typeTag("New tag");
  const pending = ref.current!.commit();
  for (const cleanup of hooks.cleanups.values()) cleanup();
  finish({ type: "created", payload: { id: "tag-b" } });
  await expect(pending).resolves.toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});
