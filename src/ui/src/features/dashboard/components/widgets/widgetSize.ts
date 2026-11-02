import { createContext } from "react";
import type { WidgetSize } from "@/features/dashboard/types";

/** The size the viewer picked in the customizer; compact narrows a card to one column. */
export const WidgetSizeContext = createContext<WidgetSize | undefined>(undefined);
