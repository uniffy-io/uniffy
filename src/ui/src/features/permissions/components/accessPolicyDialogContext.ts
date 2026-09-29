import { createContext, useContext } from "react";

export interface AccessPolicyDialogContent {
  contentType: number;
  contentId: string;
  title?: string;
  explicitUserRole?: number | null;
  /** `AccessMode` values the caller knows the server will refuse for this viewer. */
  hiddenAccessModes?: number[];
}

export interface AccessPolicyDialogContextValue {
  openFor: (
    contentType: number,
    contentId: string,
    title?: string,
    explicitUserRole?: number | null,
    hiddenAccessModes?: number[],
  ) => void;
  close: () => void;
  activeContent: AccessPolicyDialogContent | null;
  isOpen: boolean;
}

// Lives apart from the provider and dialog components so a hot reload of
// those modules never re-creates the context the mounted provider serves.
export const AccessPolicyDialogContext = createContext<AccessPolicyDialogContextValue | null>(null);

export function useAccessPolicyDialog(): AccessPolicyDialogContextValue {
  const ctx = useContext(AccessPolicyDialogContext);
  if (!ctx) {
    throw new Error("useAccessPolicyDialog must be used within AccessPolicyDialogProvider");
  }
  return ctx;
}
