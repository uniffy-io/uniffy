import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlass, X, PencilSimple, Plus } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { getTaskTypeConfig } from "@/features/projects/utils/taskTypes";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Project, Task } from "@/features/projects/types";
import {
  computeDescendantIds,
  filterParentCandidates,
} from "@/features/projects/components/detail/parentPickerUtils";

interface ParentPickerProps {
  task: Task;
  project: Project | null;
  allTasks: Task[];
  onSelect: (parentId: string | null) => void;
  onNavigate?: (taskId: string) => void;
  disabled?: boolean;
}

type TypeFilter = "epic" | "story" | null;

export function ParentPicker({
  task,
  project,
  allTasks,
  onSelect,
  onNavigate,
  disabled,
}: ParentPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const tasksMap = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of allTasks) m.set(t.id, t);
    return m;
  }, [allTasks]);

  const excludedIds = useMemo(
    () => computeDescendantIds(task.id, allTasks),
    [task.id, allTasks],
  );

  const currentParent = task.parentId ? tasksMap.get(task.parentId) ?? null : null;

  const statusField = project?.fieldDefinitions.find(
    (f) => f.id === SYSTEM_FIELD_IDS.STATUS,
  );

  const results = useMemo(
    () =>
      filterParentCandidates(allTasks, {
        excludedIds,
        typeFilter,
        query,
        projectSlug: project?.slug ?? "",
      }),
    [allTasks, excludedIds, typeFilter, query, project],
  );

  const ancestorBreadcrumb = useMemo(() => {
    if (!currentParent) return [];
    const chain: Task[] = [];
    let pId: string | null = currentParent.parentId;
    while (pId && chain.length < 5) {
      const a = tasksMap.get(pId);
      if (!a) break;
      chain.unshift(a);
      pId = a.parentId;
    }
    return chain;
  }, [currentParent, tasksMap]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setPosition({
        top: r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, 320),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey, { capture: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [isOpen]);

  const closeAndReset = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setTypeFilter(null);
  }, []);

  const handleSelect = useCallback(
    (parentId: string | null) => {
      closeAndReset();
      onSelect(parentId);
    },
    [closeAndReset, onSelect],
  );

  const renderTrigger = () => {
    if (!currentParent) {
      return (
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(true)}
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-sm border border-dashed border-border",
            "text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-muted/50",
            "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <Plus size={12} weight="bold" />
          Set parent
        </button>
      );
    }

    const TypeIcon = getTaskTypeConfig(currentParent.taskType || "task").icon;
    const ticket = `${project?.slug ?? ""}-${currentParent.number}`;
    const statusOption = statusField?.config.options?.find(
      (o) => o.id === currentParent.status,
    );
    const breadcrumbTitle = [...ancestorBreadcrumb, currentParent]
      .map((a) => a.title)
      .join(" / ");

    return (
      <div className="group flex items-center gap-1 min-w-0 w-full">
        <button
          type="button"
          onClick={() => onNavigate?.(currentParent.id)}
          className="flex-1 min-w-0 flex items-center gap-2 rounded-md border border-border bg-muted/30 hover:bg-muted/60 px-2 py-1 text-left transition-colors"
          title={breadcrumbTitle}
        >
          <TypeIcon
            size={12}
            weight="fill"
            className="text-muted-foreground shrink-0"
          />
          <span className="font-mono text-xs text-muted-foreground shrink-0">
            {ticket}
          </span>
          <span className="text-sm text-foreground truncate">
            {currentParent.title}
          </span>
          {statusOption && (
            <span
              className="ml-auto text-[10px] px-1.5 py-0.5 rounded shrink-0"
              style={{
                backgroundColor: `${statusOption.color}20`,
                color: statusOption.color,
              }}
            >
              {statusOption.label}
            </span>
          )}
        </button>
        {!disabled && (
          <>
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
              title="Change parent"
              aria-label="Change parent"
            >
              <PencilSimple size={12} />
            </button>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
              title="Remove parent"
              aria-label="Remove parent"
            >
              <X size={12} weight="bold" />
            </button>
          </>
        )}
      </div>
    );
  };

  const dropdown =
    isOpen && position
      ? createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[300] rounded-lg border border-border bg-card shadow-xl flex flex-col max-h-[60vh]"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
            role="dialog"
            aria-label="Choose parent task"
          >
            <div className="px-2 py-2 border-b border-border">
              <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/40 border border-border focus-within:border-primary/40 transition-colors">
                <MagnifyingGlass
                  size={14}
                  className="text-muted-foreground shrink-0"
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tasks by ID or title..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-w-0"
                  aria-label="Search parent tasks"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X size={12} weight="bold" />
                  </button>
                )}
              </div>
              <div className="mt-2 flex gap-1">
                {(["epic", "story"] as const).map((type) => {
                  const cfg = getTaskTypeConfig(type);
                  const Icon = cfg.icon;
                  const active = typeFilter === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setTypeFilter(active ? null : type)}
                      className={cn(
                        "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
                      )}
                    >
                      <Icon
                        size={10}
                        weight={active ? "fill" : "regular"}
                      />
                      Only {cfg.label}s
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {results.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                  {query
                    ? "No tasks match"
                    : "No eligible tasks in this project"}
                </div>
              ) : (
                <ul className="py-1">
                  {results.map((t) => {
                    const Icon = getTaskTypeConfig(t.taskType || "task").icon;
                    const ticket = `${project?.slug ?? ""}-${t.number}`;
                    const statusOption = statusField?.config.options?.find(
                      (o) => o.id === t.status,
                    );
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => handleSelect(t.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition-colors"
                        >
                          <Icon
                            size={12}
                            weight="fill"
                            className="text-muted-foreground shrink-0"
                          />
                          <span className="font-mono text-xs text-muted-foreground shrink-0">
                            {ticket}
                          </span>
                          <span className="text-sm text-foreground truncate flex-1">
                            {t.title}
                          </span>
                          {statusOption && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                              style={{
                                backgroundColor: `${statusOption.color}20`,
                                color: statusOption.color,
                              }}
                            >
                              {statusOption.label}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div ref={triggerRef} className="flex items-center min-w-0 w-full">
        {renderTrigger()}
      </div>
      {dropdown}
    </>
  );
}
