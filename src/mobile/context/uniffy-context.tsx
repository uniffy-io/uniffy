import React, { createContext, useContext, useState, useCallback } from "react";
import type { Domain } from "@/lib/types";

type ActiveTab = "home" | "you";

type AtState = {
  query: string;
  filter: "all" | Domain;
};

export type ReferenceItem = {
  id: string;
  label: string;
  domain: Domain;
};

type UniffyContextType = {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  atOpen: boolean;
  atFromEditor: boolean;
  openAt: (fromEditor?: boolean) => void;
  closeAt: () => void;
  toggleAt: () => void;
  returnToAt: boolean;
  setReturnToAt: (v: boolean) => void;
  savedAtState: AtState | null;
  saveAtState: (state: AtState) => void;
  pendingReference: ReferenceItem | null;
  insertReference: (item: ReferenceItem) => void;
  clearPendingReference: () => void;
};

const UniffyContext = createContext<UniffyContextType | null>(null);

export function UniffyProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("home");
  const [atOpen, setAtOpen] = useState(false);
  const [atFromEditor, setAtFromEditor] = useState(false);
  const [returnToAt, setReturnToAt] = useState(false);
  const [savedAtState, setSavedAtState] = useState<AtState | null>(null);
  const [pendingReference, setPendingReference] = useState<ReferenceItem | null>(null);

  const openAt = useCallback((fromEditor = false) => {
    setAtFromEditor(fromEditor);
    setAtOpen(true);
  }, []);
  const closeAt = useCallback(() => {
    setAtOpen(false);
    setAtFromEditor(false);
  }, []);
  const toggleAt = useCallback(
    () =>
      setAtOpen((v) => {
        if (v) setAtFromEditor(false);
        return !v;
      }),
    [],
  );
  const saveAtState = useCallback((state: AtState) => setSavedAtState(state), []);
  const insertReference = useCallback((item: ReferenceItem) => setPendingReference(item), []);
  const clearPendingReference = useCallback(() => setPendingReference(null), []);

  return (
    <UniffyContext.Provider
      value={{
        activeTab,
        setActiveTab,
        atOpen,
        atFromEditor,
        openAt,
        closeAt,
        toggleAt,
        returnToAt,
        setReturnToAt,
        savedAtState,
        saveAtState,
        pendingReference,
        insertReference,
        clearPendingReference,
      }}
    >
      {children}
    </UniffyContext.Provider>
  );
}

export function useUniffy() {
  const ctx = useContext(UniffyContext);
  if (!ctx) throw new Error("useUniffy must be used within UniffyProvider");
  return ctx;
}
