import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import {
  emitContentAccessChanged,
  type ContentAccessAction,
  type ContentAccessChange,
} from "@/features/notifications/contentAccessEmitter";
import { useContentAccessRefetch } from "@/features/notifications/hooks/useContentAccessRefetch";

const lifecycle = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
}));

let cleanups: Array<() => void> = [];

function mount(types: ContentType | ContentType[] = ContentType.PROJECT) {
  const refetch = vi.fn();
  // React lifecycle is mocked for this test harness.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useContentAccessRefetch(types, refetch);
  cleanups = lifecycle.effects.flatMap((effect) => {
    const cleanup = effect();
    return cleanup ? [cleanup] : [];
  });
  return refetch;
}

function change(action: ContentAccessAction, contentId = "project-1"): ContentAccessChange {
  return { contentType: ContentType.PROJECT, contentId, action };
}

beforeEach(() => {
  vi.useFakeTimers();
  lifecycle.effects = [];
});

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  vi.useRealTimers();
});

describe("useContentAccessRefetch", () => {
  it.each<[ContentAccessAction, ContentAccessAction]>([
    ["child_added", "views_changed"],
    ["views_changed", "child_added"],
    ["granted", "views_changed"],
    ["views_changed", "revoked"],
  ])("keeps both %s and %s in one burst", (first, second) => {
    const refetch = mount();
    emitContentAccessChanged(change(first));
    vi.advanceTimersByTime(250);
    emitContentAccessChanged(change(second));
    vi.advanceTimersByTime(499);
    expect(refetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refetch.mock.calls).toEqual([[change(first)], [change(second)]]);
  });

  it("coalesces repeated actions on one resource", () => {
    const refetch = mount();
    for (let index = 0; index < 10; index++) {
      emitContentAccessChanged(change("views_changed"));
    }
    vi.advanceTimersByTime(500);
    expect(refetch.mock.calls).toEqual([[change("views_changed")]]);
    emitContentAccessChanged(change("views_changed"));
    vi.advanceTimersByTime(500);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("keeps changes to separate projects", () => {
    const refetch = mount();
    emitContentAccessChanged(change("views_changed", "project-1"));
    emitContentAccessChanged(change("views_changed", "project-2"));
    vi.advanceTimersByTime(500);
    expect(refetch.mock.calls).toEqual([
      [change("views_changed", "project-1")],
      [change("views_changed", "project-2")],
    ]);
  });

  it("ignores other content types", () => {
    const refetch = mount();
    emitContentAccessChanged({ ...change("granted"), contentType: ContentType.NOTE });
    vi.advanceTimersByTime(500);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("keeps the same action and id for different subscribed types", () => {
    const refetch = mount([ContentType.PROJECT, ContentType.NOTE]);
    const project = change("granted");
    const note = { ...project, contentType: ContentType.NOTE };
    emitContentAccessChanged(project);
    emitContentAccessChanged(note);
    vi.advanceTimersByTime(500);
    expect(refetch.mock.calls).toEqual([[project], [note]]);
  });

  it("discards pending work and unsubscribes on unmount", () => {
    const refetch = mount();
    emitContentAccessChanged(change("views_changed"));
    cleanups.forEach((cleanup) => cleanup());
    cleanups = [];
    emitContentAccessChanged(change("child_added"));
    vi.advanceTimersByTime(500);
    expect(refetch).not.toHaveBeenCalled();
  });
});
