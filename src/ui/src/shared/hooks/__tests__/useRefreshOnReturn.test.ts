import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listenForReturn } from "@/shared/hooks/useRefreshOnReturn";

let page: EventTarget & { visibilityState: DocumentVisibilityState };
let frame: EventTarget;

beforeEach(() => {
  vi.useFakeTimers();
  page = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
  });
  frame = new EventTarget();
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", frame);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("refreshes once when focus and visibility arrive together", () => {
  const refresh = vi.fn();
  const stop = listenForReturn(refresh);

  page.dispatchEvent(new Event("visibilitychange"));
  frame.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(1_000);
  frame.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
});

it("skips a hidden tab and stops after unsubscribe", () => {
  const refresh = vi.fn();
  const stop = listenForReturn(refresh);

  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  expect(refresh).not.toHaveBeenCalled();

  stop();
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  expect(refresh).not.toHaveBeenCalled();
});
