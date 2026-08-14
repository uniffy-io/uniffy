/** Singleton streaming connections for the authenticated session — mount once under ProtectedRoute to avoid duplicate Valkey connections on every nav. */

import { useNotificationStream } from "@/features/notifications/hooks/useNotificationStream";
import { usePushNotificationClick } from "@/features/notifications/hooks/usePushNotificationClick";
import { usePresenceHeartbeat } from "@/features/presence/hooks/usePresenceHeartbeat";
import { ChatStreamProvider } from "@/features/chat/components/ChatStreamProvider";

export function StreamingProvider() {
  useNotificationStream();
  usePushNotificationClick();
  usePresenceHeartbeat();
  return <ChatStreamProvider />;
}
