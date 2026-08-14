import { createContext } from "react";

/**
 * Context that signals sidebar children are rendered inside the hover overlay.
 * Sidebar headers can check this to adjust behavior when in overlay mode.
 */
export const SidebarOverlayContext = createContext(false);
