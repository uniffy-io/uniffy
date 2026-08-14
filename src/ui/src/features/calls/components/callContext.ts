import { createContext, useContext } from "react";
import type { Room } from "livekit-client";

export interface JoinMediaOptions {
  micEnabled: boolean;
  cameraEnabled: boolean;
}

export interface CallContextValue {
  room: Room | null;
  joinChannelCall: (channelId: string, opts: JoinMediaOptions) => Promise<void>;
  joinCallById: (callId: string, channelId: string, opts: JoinMediaOptions) => Promise<void>;
  leaveCurrentCall: () => Promise<void>;
  endCurrentCall: () => Promise<void>;
  rejoin: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  switchDevice: (kind: MediaDeviceKind, deviceId: string) => Promise<void>;
  focusCallTab: () => void;
}

export const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}
