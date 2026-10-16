export { useDocSession } from "@/features/realtime/hooks/useDocSession";
export { useMarkdownDocSession } from "@/features/realtime/hooks/useMarkdownDocSession";
export { useDocAwareness } from "@/features/realtime/hooks/useDocAwareness";
export {
  useDeviceRecoveryState,
  useDocSaveState,
  useRealtimeDocState,
  type SaveState,
} from "@/features/realtime/hooks/useDocSaveState";
export { usePendingDocSync } from "@/features/realtime/hooks/useRealtimeDrain";
export { docContentTypeName, docNameFor } from "@/features/realtime/docNames";
export { RealtimeStatusBadge } from "@/features/realtime/components/RealtimeStatusBadge";
export { RealtimeSessionStatus } from "@/features/realtime/components/RealtimeSessionStatus";
export { hasUnsyncedEdits } from "@/features/realtime/unsyncedEdits";
export { clearPendingDocsFor } from "@/features/realtime/pendingDocs";
export {
  discoverStoredPendingDocs,
  HYDRATION_ORIGIN,
  type DeviceRecoveryState,
  type DeviceStorage,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
export type { RealtimeDocState } from "@/features/realtime/multiplexer";
export type { RealtimeStatus } from "@/features/realtime/protocol";
