import { IceTransportPolicy } from "@uniffy/proto/calls/v1/calls_pb";
import type { IceServerData } from "@/features/calls/types";

/**
 * Maps JoinCall ICE config to the RTCConfiguration for Room.connect. An empty
 * server list is direct-media mode: return undefined so livekit-client keeps
 * the ICE servers it receives over signaling.
 */
export function buildRtcConfiguration(
  iceServers: IceServerData[],
  policy: IceTransportPolicy,
): RTCConfiguration | undefined {
  if (iceServers.length === 0) return undefined;
  const config: RTCConfiguration = {
    iceServers: iceServers.map((server) => ({ ...server, urls: [...server.urls] })),
  };
  if (policy === IceTransportPolicy.RELAY) config.iceTransportPolicy = "relay";
  return config;
}
