import { afterEach, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ cleanup: undefined as undefined | (() => void) }));
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    lifecycle.cleanup = effect() || undefined;
  },
}));
import { useUnloadGuard } from "@/shared/hooks/useUnloadGuard";

afterEach(() => {
  lifecycle.cleanup?.();
  vi.unstubAllGlobals();
});

it("prompts only while pending and removes the listener on cleanup", () => {
  const target = new EventTarget();
  const add = vi.spyOn(target, "addEventListener");
  const remove = vi.spyOn(target, "removeEventListener");
  vi.stubGlobal("window", target);
  useUnloadGuard(false);
  expect(add).not.toHaveBeenCalled();
  useUnloadGuard(true);
  const event = new Event("beforeunload", { cancelable: true });
  Object.defineProperty(event, "returnValue", { value: undefined, writable: true });
  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  lifecycle.cleanup?.();
  expect(remove).toHaveBeenCalledWith("beforeunload", add.mock.calls[0][1]);
});
