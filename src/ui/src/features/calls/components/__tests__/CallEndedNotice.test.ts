import { beforeEach, expect, it, vi } from "vitest";
import type { CallEndedInfo } from "@/features/calls/types";
import { CallEndedNotice } from "@/features/calls/components/CallEndedNotice";

const state = vi.hoisted(() => ({
  calls: { endedInfo: null as CallEndedInfo | null, selfEndedCallId: null as string | null },
  lastNotice: { current: null as string | null },
  navigate: vi.fn(),
  dispatch: vi.fn(),
  info: vi.fn(),
  effects: [] as (() => void)[],
}));

vi.mock("react", () => ({
  useRef: () => state.lastNotice,
  useEffect: (effect: () => void) => state.effects.push(effect),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => state.navigate }));
vi.mock("sonner", () => ({ toast: { info: state.info } }));
vi.mock("@/app/hooks", () => ({
  useAppDispatch: () => state.dispatch,
  useAppSelector: (select: (value: unknown) => unknown) => select(state),
}));

function render() {
  CallEndedNotice();
  for (const effect of state.effects.splice(0)) effect();
}

beforeEach(() => {
  vi.clearAllMocks();
  state.lastNotice.current = null;
  state.calls.endedInfo = { callId: "call", channelId: "channel", reason: "HOST_ENDED" };
  state.calls.selfEndedCallId = null;
});

it("does not replay a dismissed notice when navigation changes", () => {
  render();
  state.navigate = vi.fn();
  render();
  expect(state.info).toHaveBeenCalledTimes(1);
  expect(state.dispatch).toHaveBeenCalledTimes(1);
  expect(state.calls.endedInfo?.callId).toBe("call");
});

it("updates the notice when the end reason resolves", () => {
  state.calls.endedInfo!.reason = null;
  render();
  state.calls.endedInfo = { callId: "call", channelId: "channel", reason: "HOST_ENDED" };
  render();
  render();
  expect(state.info).toHaveBeenCalledTimes(2);
  expect(state.info.mock.calls[0][1].id).toBe(state.info.mock.calls[1][1].id);
});

it("keeps a self-ended call silent", () => {
  state.calls.selfEndedCallId = "call";
  render();
  state.navigate = vi.fn();
  render();
  expect(state.info).not.toHaveBeenCalled();
});

it("allows a later call to show its own notice", () => {
  render();
  state.calls.endedInfo = null;
  render();
  state.calls.endedInfo = { callId: "next", channelId: "channel", reason: "ALL_LEFT" };
  render();
  expect(state.info).toHaveBeenCalledTimes(2);
  state.info.mock.calls[1][1].action.onClick();
  expect(state.navigate).toHaveBeenCalledWith("/calls/next");
});
