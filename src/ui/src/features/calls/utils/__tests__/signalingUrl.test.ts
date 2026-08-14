import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSignalingUrl } from "@/features/calls/utils/signalingUrl";
import { getTokenExpiryMs } from "@/features/calls/utils/livekitToken";

describe("resolveSignalingUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:8080" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a path against the current origin", () => {
    expect(resolveSignalingUrl("/livekit")).toBe("ws://localhost:8080/livekit");
  });

  it("normalizes a path without a leading slash", () => {
    expect(resolveSignalingUrl("livekit")).toBe("ws://localhost:8080/livekit");
  });

  it("uses wss on https origins", () => {
    vi.stubGlobal("window", {
      location: { protocol: "https:", host: "uniffy.example.com" },
    });
    expect(resolveSignalingUrl("/livekit")).toBe("wss://uniffy.example.com/livekit");
  });

  it("passes absolute ws URLs through verbatim", () => {
    expect(resolveSignalingUrl("ws://sfu.example.com:7880")).toBe("ws://sfu.example.com:7880");
    expect(resolveSignalingUrl("wss://livekit.customer.io")).toBe("wss://livekit.customer.io");
  });
});

describe("getTokenExpiryMs", () => {
  it("reads exp from a JWT payload", () => {
    const payload = btoa(JSON.stringify({ exp: 1_700_000_000 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(getTokenExpiryMs(`header.${payload}.sig`)).toBe(1_700_000_000_000);
  });

  it("returns null for malformed tokens", () => {
    expect(getTokenExpiryMs("not-a-jwt")).toBeNull();
    expect(getTokenExpiryMs("a.b.c")).toBeNull();
  });
});
