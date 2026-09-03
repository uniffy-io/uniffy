import { createRouteLoader } from "@/shared/utils/createRouteLoader";

export const { load: loadChatPage, preload: preloadChatPage } = createRouteLoader(
  () => import("@/features/chat/pages/ChatPage"),
);
