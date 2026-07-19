import type { RoomConnectOptions } from "livekit-client";
import type { IceServer as ProtoIceServer } from "@uniffy/proto/calls/v1/calls_pb";
import { IceTransportPolicy } from "@uniffy/proto/calls/v1/calls_pb";

export interface IceServerData {
  urls: string[];
  username?: string;
  credential?: string;
}

export function iceServersToPlain(servers: ProtoIceServer[]): IceServerData[] {
  return servers.map((server) => ({
    urls: [...server.urls],
    ...(server.username !== undefined && { username: server.username }),
    ...(server.credential !== undefined && { credential: server.credential }),
  }));
}

/**
 * Maps JoinCall ICE config to the RTCConfiguration for Room.connect. An empty
 * server list is direct-media mode: return undefined so livekit-client keeps
 * the ICE servers it receives over signaling.
 */
export function buildRtcConfiguration(
  iceServers: IceServerData[],
  policy: IceTransportPolicy,
): RoomConnectOptions["rtcConfig"] {
  if (iceServers.length === 0) return undefined;
  return {
    iceServers: iceServers.map((server) => ({
      urls: [...server.urls],
      ...(server.username !== undefined && { username: server.username }),
      ...(server.credential !== undefined && { credential: server.credential }),
    })),
    ...(policy === IceTransportPolicy.RELAY && { iceTransportPolicy: "relay" as const }),
  };
}
