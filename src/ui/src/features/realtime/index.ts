export { realtimeMultiplexer } from "@/features/realtime/multiplexer";
export type { DocSubscription, MultiplexerAttachOptions } from "@/features/realtime/multiplexer";
export { useDocSession } from "@/features/realtime/hooks/useDocSession";
export type { DocSession, UseDocSessionOptions } from "@/features/realtime/hooks/useDocSession";
export { useDocAwareness, setLocalAwareness } from "@/features/realtime/hooks/useDocAwareness";
export { useOutboundSyncing } from "@/features/realtime/hooks/useOutboundSyncing";
export type { AwarenessPeer } from "@/features/realtime/hooks/useDocAwareness";
export { RealtimePresence } from "@/features/realtime/components/RealtimePresence";
export {
  attachEncryptedPersistence,
  HYDRATION_ORIGIN,
  REMOTE_ORIGIN,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
export type {
  EncryptedPersistence,
  EncryptedPersistenceOptions,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
export {
  CANONICAL_SUBPROTOCOL,
  WS_CLOSE_FORBIDDEN,
  WS_CLOSE_TOKEN_REVOKED,
  WS_CLOSE_NOT_FOUND,
  statusFromCloseCode,
} from "@/features/realtime/protocol";
export type { RealtimeStatus } from "@/features/realtime/protocol";
export { encodeDocFrame, peekVarString } from "@/features/realtime/multiplex";
