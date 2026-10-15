import { afterEach, expect, it, vi } from "vitest";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import {
  emitContentChanged,
  subscribeContentRefresh,
} from "@/features/notifications/contentChangedEmitter";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
  vi.useRealTimers();
});

it("refreshes only matching open readers and bounds a continuous burst", () => {
  vi.useFakeTimers();
  const task = vi.fn();
  const event = vi.fn();
  cleanups.push(subscribeContentRefresh(ContentType.TASK, "one", task));
  cleanups.push(subscribeContentRefresh(ContentType.CALENDAR_EVENT, "one", event));
  for (let i = 0; i < 6; i++) {
    emitContentChanged({ contentType: ContentType.TASK, contentId: "one" });
    emitContentChanged({ contentType: ContentType.TASK, contentId: "other" });
    vi.advanceTimersByTime(100);
  }
  expect(task).toHaveBeenCalledTimes(2);
  expect(event).not.toHaveBeenCalled();
});

it("repairs missed hints after reconnect and cancels closed readers", () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const stop = subscribeContentRefresh(ContentType.TASK, "task", refresh);
  cleanups.push(stop);
  emitContentChanged(null);
  vi.advanceTimersByTime(300);
  expect(refresh).toHaveBeenCalledOnce();
  emitContentChanged(null);
  stop();
  vi.advanceTimersByTime(300);
  expect(refresh).toHaveBeenCalledOnce();
});
