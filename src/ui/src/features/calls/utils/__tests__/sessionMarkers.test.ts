import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCallMarkers,
  consumeSessionMarker,
  readRecentMarker,
  writeCallMarkers,
  type CallSessionMarker,
} from "@/features/calls/utils/sessionMarkers";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function marker(organizationId: string): CallSessionMarker {
  return {
    callId: "call",
    channelId: "channel",
    organizationId,
    micEnabled: true,
    cameraEnabled: false,
    ts: Date.now(),
  };
}

describe("call session markers", () => {
  it("round-trips the organization the call belongs to", () => {
    writeCallMarkers(marker("org-a"));
    expect(readRecentMarker()?.organizationId).toBe("org-a");
    expect(consumeSessionMarker()?.organizationId).toBe("org-a");
    expect(consumeSessionMarker()).toBeNull();
  });

  it("ignores a marker that names no organization", () => {
    const unscoped: Partial<CallSessionMarker> = marker("org-a");
    delete unscoped.organizationId;
    localStorage.setItem("uniffy-recent-call", JSON.stringify(unscoped));
    expect(readRecentMarker()).toBeNull();
  });

  it("leaving one organization keeps another organization's device marker", () => {
    writeCallMarkers(marker("org-b"));
    clearCallMarkers("org-a");
    expect(consumeSessionMarker()).toBeNull();
    expect(readRecentMarker()?.organizationId).toBe("org-b");

    clearCallMarkers("org-b");
    expect(readRecentMarker()).toBeNull();
  });

  it("clears both markers without an organization", () => {
    writeCallMarkers(marker("org-a"));
    clearCallMarkers();
    expect(consumeSessionMarker()).toBeNull();
    expect(readRecentMarker()).toBeNull();
  });
});
