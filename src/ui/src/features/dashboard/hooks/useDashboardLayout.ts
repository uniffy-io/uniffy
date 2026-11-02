import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  selectDashboardCatalog,
  selectDashboardSaving,
  selectSavedDashboard,
  selectSavedDashboardStatus,
} from "@/features/dashboard/store/dashboardSlice";
import {
  fetchDashboard,
  fetchDashboardCatalog,
  restorePreviousDashboard,
  saveDashboard,
} from "@/features/dashboard/store/dashboardThunks";
import type {
  DashboardDefinition,
  DashboardWidget,
  WidgetFilters,
} from "@/features/dashboard/types";
import {
  fullLayout,
  legacyLayoutKey,
  moveWidget as moveInList,
  parseLegacyLayout,
} from "@/features/dashboard/utils/layout";

function readLegacy(userId: string): DashboardDefinition | null {
  try {
    return parseLegacyLayout(localStorage.getItem(legacyLayoutKey(userId)));
  } catch {
    return null;
  }
}

function dropLegacy(userId: string): void {
  try {
    localStorage.removeItem(legacyLayoutKey(userId));
  } catch {
    // Storage unavailable; the server copy is what loads from now on.
  }
}

/** The viewer's server-saved layout for this organization, with an edit buffer for the customizer. */
export function useDashboardLayout() {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((state) => state.auth.user?.id ?? "");
  const orgId = useAppSelector((state) => state.auth.currentOrganizationId);
  const catalog = useAppSelector(selectDashboardCatalog);
  const saved = useAppSelector(selectSavedDashboard);
  const savedStatus = useAppSelector(selectSavedDashboardStatus);
  const saving = useAppSelector(selectDashboardSaving);

  const [editBuffer, setEditBuffer] = useState<DashboardWidget[] | null>(null);
  const [editName, setEditName] = useState("");
  const migratedRef = useRef(false);

  useEffect(() => {
    if (!catalog) void dispatch(fetchDashboardCatalog());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (orgId) void dispatch(fetchDashboard());
  }, [orgId, dispatch]);

  // A layout kept in this browser by older versions moves to the server once, then the copy goes.
  useEffect(() => {
    if (migratedRef.current || !catalog || savedStatus !== "ready" || !userId) return;
    migratedRef.current = true;
    const legacy = readLegacy(userId);
    if (!legacy) return;
    if (saved.definition) {
      dropLegacy(userId);
      return;
    }
    void dispatch(saveDashboard({ definition: legacy }))
      .unwrap()
      .then(() => dropLegacy(userId))
      // The rejected thunk already surfaced through the error toast middleware.
      .catch(() => {});
  }, [catalog, savedStatus, saved.definition, userId, dispatch]);

  const definition = saved.definition ?? catalog?.defaultDefinition ?? null;
  const layout = useMemo(
    () => (definition && catalog ? fullLayout(definition, catalog) : []),
    [definition, catalog],
  );
  const widgets = editBuffer ?? layout;
  const isEditing = editBuffer !== null;
  const ready = catalog !== null && savedStatus !== "idle" && savedStatus !== "loading";

  const name = definition?.name ?? "";
  const startEditing = useCallback(() => {
    setEditBuffer([...layout]);
    setEditName(name);
  }, [layout, name]);
  const cancelEditing = useCallback(() => setEditBuffer(null), []);

  const persist = useCallback(
    async (next: DashboardDefinition, keepPrevious = false) => {
      try {
        await dispatch(saveDashboard({ definition: next, keepPrevious })).unwrap();
        setEditBuffer(null);
      } catch {
        // Surfaced by the error toast middleware; the editor stays open with the edit.
      }
    },
    [dispatch],
  );

  const saveEditing = useCallback(() => {
    if (!editBuffer) return;
    // A hand edit is no longer the template itself, but it keeps the name it was given.
    void persist({ widgets: editBuffer, preset: "", name: editName.trim() });
  }, [editBuffer, editName, persist]);

  const update = useCallback(
    (id: string, change: (widget: DashboardWidget) => DashboardWidget) =>
      setEditBuffer((prev) => (prev ? prev.map((w) => (w.id === id ? change(w) : w)) : prev)),
    [],
  );

  const toggleVisibility = useCallback(
    (id: string) => update(id, (w) => ({ ...w, visible: !w.visible })),
    [update],
  );
  const toggleSize = useCallback(
    (id: string) =>
      update(id, (w) => ({ ...w, size: w.size === "compact" ? "expanded" : "compact" })),
    [update],
  );
  const setFilters = useCallback(
    (id: string, filters: WidgetFilters) =>
      update(id, (w) => ({ ...w, filters, unsupportedFilters: [] })),
    [update],
  );
  const moveWidget = useCallback(
    (from: number, to: number) =>
      setEditBuffer((prev) => (prev ? moveInList(prev, from, to) : prev)),
    [],
  );

  const applyDefinition = useCallback(
    (next: DashboardDefinition) => persist(next, true),
    [persist],
  );
  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = catalog?.presets.find((p) => p.id === presetId);
      if (preset) void applyDefinition(preset.definition);
    },
    [catalog, applyDefinition],
  );
  const resetToDefault = useCallback(() => {
    if (catalog) void applyDefinition(catalog.defaultDefinition);
  }, [catalog, applyDefinition]);
  /** Renames the dashboard as it stands; widgets, template and restore point stay. */
  const rename = useCallback(
    (nextName: string) => {
      if (definition) void persist({ ...definition, name: nextName });
    },
    [definition, persist],
  );
  const restorePrevious = useCallback(async () => {
    try {
      await dispatch(restorePreviousDashboard()).unwrap();
      setEditBuffer(null);
    } catch {
      // Surfaced by the error toast middleware.
    }
  }, [dispatch]);

  return {
    ready,
    catalog,
    widgets,
    visibleWidgets: widgets.filter((w) => w.visible),
    activePreset: saved.definition?.preset ?? "",
    name: isEditing ? editName : name,
    setName: setEditName,
    hasPrevious: saved.hasPrevious,
    saving,
    isEditing,
    startEditing,
    cancelEditing,
    saveEditing,
    toggleVisibility,
    toggleSize,
    setFilters,
    moveWidget,
    applyPreset,
    applyDefinition,
    resetToDefault,
    restorePrevious,
    rename,
  };
}
