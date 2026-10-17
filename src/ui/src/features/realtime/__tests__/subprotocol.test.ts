import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import {
  AUTH_REFRESHED_EVENT,
  statusFromCloseCode,
  type RealtimeStatus,
} from "@/features/realtime/protocol";
import {
  FakeWebSocket,
  attachDoc,
  connect,
  detachAll,
  installRealtimeGlobals,
} from "@/features/realtime/hooks/__tests__/realtimeHarness";

beforeAll(installRealtimeGlobals);
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  detachAll();
  vi.useRealTimers();
});

it("offers only the v2 subprotocol beside the bearer token", () => {
  const ws = connect(attachDoc("offer"));
  expect(ws.protocols).toEqual(["uniffy.realtime.v2", "bearer.test-token"]);
});

// Close 4426 latches the shared transport until a reload, so this runs after the offer case.
it("asks for a reload on close 4426 and never reconnects", () => {
  const statuses: RealtimeStatus[] = [];
  const closeCodes: number[] = [];
  const doc = attachDoc("upgrade", {
    onStatus: (status) => statuses.push(status),
    onCloseCode: (code) => closeCodes.push(code),
  });
  const ws = connect(doc);
  doc.ydoc.getText("markdown").insert(0, "kept on this device");
  vi.advanceTimersByTime(50);

  ws.serverClose(4426);
  expect(closeCodes.map(statusFromCloseCode)).toEqual(["upgrade_required"]);
  expect(statuses.at(-1)).toBe("upgrade_required");
  const opened = FakeWebSocket.instances.length;
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new Event(AUTH_REFRESHED_EVENT));
  realtimeMultiplexer.retryConnection();
  vi.advanceTimersByTime(120_000);
  expect(FakeWebSocket.instances).toHaveLength(opened);
  expect(statuses.at(-1)).toBe("upgrade_required");
  expect(realtimeMultiplexer.getDocState(doc.docName).transportPending).toBe(true);

  const later: RealtimeStatus[] = [];
  attachDoc("opened-later", { onStatus: (status) => later.push(status) });
  expect(later).toEqual(["upgrade_required"]);
  expect(FakeWebSocket.instances).toHaveLength(opened);
});
