import { describe, expect, it } from "vitest";
import { IceTransportPolicy } from "@uniffy/proto/calls/v1/calls_pb";
import { buildRtcConfiguration } from "@/features/calls/utils/iceConfig";

const SERVER = {
  urls: ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"],
  username: "1700000000:user-uuid",
  credential: "base64digest=",
};

describe("buildRtcConfiguration", () => {
  it("returns undefined for an empty server list (direct media mode)", () => {
    expect(buildRtcConfiguration([], IceTransportPolicy.UNSPECIFIED)).toBeUndefined();
    expect(buildRtcConfiguration([], IceTransportPolicy.RELAY)).toBeUndefined();
  });

  it("maps servers and forces relay when the policy is RELAY", () => {
    const config = buildRtcConfiguration([SERVER], IceTransportPolicy.RELAY);
    expect(config).toEqual({
      iceServers: [
        {
          urls: SERVER.urls,
          username: SERVER.username,
          credential: SERVER.credential,
        },
      ],
      iceTransportPolicy: "relay",
    });
  });

  it("leaves the transport policy unset unless RELAY", () => {
    for (const policy of [IceTransportPolicy.UNSPECIFIED, IceTransportPolicy.ALL]) {
      const config = buildRtcConfiguration([SERVER], policy);
      expect(config?.iceTransportPolicy).toBeUndefined();
      expect(config?.iceServers).toHaveLength(1);
    }
  });

  it("omits credentials that the server entry does not carry", () => {
    const config = buildRtcConfiguration(
      [{ urls: ["stun:stun.example.com"] }],
      IceTransportPolicy.ALL,
    );
    expect(config?.iceServers?.[0]).toEqual({ urls: ["stun:stun.example.com"] });
  });
});
