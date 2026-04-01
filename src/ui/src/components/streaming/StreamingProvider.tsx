/**
 * StreamingProvider - Singleton streaming connections for the authenticated session.
 *
 * Mounts once inside ProtectedRoute and maintains persistent connections:
 * 1. Notification stream (notifications, presence, mentions)
 * 2. User-level chat stream (unread counts, thread activity)
 * 3. Channel-level chat stream (messages, typing, reactions for active channel)
 * 4. Presence heartbeat (online/away tracking)
 *
 * These hooks previously lived inside AppHeader, which remounts on every page
 * navigation, causing duplicate Valkey connections and event loop congestion.
 */

import { useNotificationStream } from '@/features/notifications/hooks/useNotificationStream';
import { usePresenceHeartbeat } from '@/features/presence/hooks/usePresenceHeartbeat';
import { ChatStreamProvider } from '@/features/chat/components/ChatStreamProvider';

export function StreamingProvider() {
  useNotificationStream();
  usePresenceHeartbeat();
  return <ChatStreamProvider />;
}
