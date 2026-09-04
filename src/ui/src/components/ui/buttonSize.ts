import { createContext } from "react";

export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon";

// A container (ModalFooter) sets the size for the buttons inside it so every
// dialog action lands at the same height without each call site repeating it.
export const ButtonSizeContext = createContext<ButtonSize | undefined>(undefined);
