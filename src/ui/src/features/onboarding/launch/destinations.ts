import { preloadDashboard, preloadNotesPage } from "@/app/mainRouteLoaders";
import { preloadChatPage } from "@/features/chat/pages/chatPageLoader";

const PRELOAD: Record<string, () => void> = {
  "/": preloadDashboard,
  "/notes": preloadNotesPage,
  "/chat": preloadChatPage,
};

/** Warms the destination chunk so the curtain opens onto the page, not a loading state. */
export function preloadDestination(destination: string) {
  PRELOAD[destination]?.();
}
