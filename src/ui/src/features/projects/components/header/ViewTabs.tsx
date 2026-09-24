import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CaretDown,
  DotsThree,
  Copy,
  LinkSimple,
  LockSimple,
  PencilSimple,
  Plus,
  PushPin,
  Trash,
  UsersThree,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { ViewVisibility } from "@uniffy/proto/projects/v1/projects_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Project, ViewConfig } from "@/features/projects/types";
import { openView } from "@/features/projects/store/projectsUiSlice";
import {
  createViewOfType,
  duplicateView,
  moveView,
  removeView,
  renameView,
  setDefaultView,
  setViewVisibility,
} from "@/features/projects/store/viewActions";
import { viewGates } from "@/features/projects/utils/viewGates";
import { VIEW_TYPE_ICONS, VIEW_TYPE_OPTIONS } from "@/features/projects/utils/viewTypes";
import { ViewNameDialog } from "@/features/projects/components/header/ViewNameDialog";
import { viewLink } from "@/features/projects/utils/viewLinks";

interface ViewTabsProps {
  project: Project;
  views: readonly ViewConfig[];
  activeViewId: string | null;
  dirtyViewIds: readonly string[];
  /** Inactive tabs are icon-only; a narrow bar hides the active tab's name too. */
  showActiveLabel: boolean;
  /** A phone-width bar: the tabs collapse into a select. */
  compact: boolean;
  canEdit: boolean;
  canManage: boolean;
}

export function ViewTabs({
  project,
  views,
  activeViewId,
  dirtyViewIds,
  showActiveLabel,
  compact,
  canEdit,
  canManage,
}: ViewTabsProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? null);
  const [menuViewId, setMenuViewId] = useState<string | null>(null);
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [deletingView, setDeletingView] = useState<ViewConfig | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [renamingInDialog, setRenamingInDialog] = useState<ViewConfig | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAllViewsOpen, setIsAllViewsOpen] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const allViewsTriggerRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // More tabs than the bar fits: the strip scrolls, keeps the open tab in view, and a menu lists
  // every view.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const measure = () => {
      setIsOverflowing(strip.scrollWidth > strip.clientWidth + 1);
      if (activeViewId) {
        strip
          .querySelector(`[data-view-id="${globalThis.CSS.escape(activeViewId)}"]`)
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    for (const child of Array.from(strip.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [views.length, showActiveLabel, activeViewId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const gatesFor = (view: ViewConfig) =>
    viewGates(view, {
      canEdit,
      canManage,
      currentUserId,
      isDefault: project.defaultViewId === view.id,
    });

  const open = (viewId: string) => dispatch(openView({ projectId: project.id, viewId }));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    dispatch(moveView(project.id, String(active.id), String(over.id)));
  };

  const menuView = views.find((view) => view.id === menuViewId) ?? null;
  const closeMenu = () => setMenuViewId(null);

  const handleCopyLink = (view: ViewConfig) => {
    closeMenu();
    navigator.clipboard
      .writeText(viewLink(project.id, view.id))
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Could not copy the link"));
  };

  const handleRename = async (view: ViewConfig, name: string) => {
    setRenamingViewId(null);
    const trimmed = name.trim();
    if (trimmed && trimmed !== view.name) await dispatch(renameView(project.id, view.id, trimmed));
  };

  const handleDelete = async () => {
    if (!deletingView) return;
    setIsDeleting(true);
    try {
      await dispatch(removeView(project.id, deletingView.id));
    } finally {
      setIsDeleting(false);
      setDeletingView(null);
    }
  };

  const openMenu = (view: ViewConfig, trigger: HTMLButtonElement) => {
    menuTriggerRef.current = trigger;
    setMenuViewId(view.id);
  };

  const addButton = (
    <button
      ref={addTriggerRef}
      type="button"
      onClick={() => setIsAddOpen(true)}
      title="New view"
      aria-label="New view"
      className="focus-ring flex h-11 w-11 lg:h-7 lg:w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      <Plus size={14} weight="bold" />
    </button>
  );

  return (
    <>
      {compact ? (
        <div className="flex min-w-0 items-center gap-0.5">
          <Select
            value={activeViewId ?? undefined}
            onChange={open}
            options={views.map((view) => ({
              value: view.id,
              label: dirtyViewIds.includes(view.id) ? `${view.name} (edited)` : view.name,
              icon: VIEW_TYPE_ICONS[view.type],
            }))}
            size="sm"
            ariaLabel="View"
            className="min-w-0 max-w-44 [&>button]:min-h-11"
          />
          {activeViewId && (
            <button
              type="button"
              onClick={(event) => {
                const view = views.find((candidate) => candidate.id === activeViewId);
                if (view) openMenu(view, event.currentTarget);
              }}
              title="View options"
              aria-label="View options"
              className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <CaretDown size={14} />
            </button>
          )}
          {addButton}
        </div>
      ) : (
        <div className="flex min-w-0 shrink items-center gap-0.5">
          <div
            ref={stripRef}
            className="flex min-w-0 shrink items-center gap-0.5 overflow-x-auto rounded-lg bg-muted/60 p-0.5"
            role="tablist"
            aria-label="Views"
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={views.map((view) => view.id)}
                strategy={horizontalListSortingStrategy}
              >
                {views.map((view) => (
                  <ViewTab
                    key={view.id}
                    view={view}
                    isActive={view.id === activeViewId}
                    isDirty={dirtyViewIds.includes(view.id)}
                    isDefault={project.defaultViewId === view.id}
                    showLabel={showActiveLabel && view.id === activeViewId}
                    canReorder={gatesFor(view).canReorder}
                    isRenaming={renamingViewId === view.id}
                    onOpen={() => open(view.id)}
                    onOpenMenu={(trigger) => openMenu(view, trigger)}
                    onRename={(name) => handleRename(view, name)}
                    onCancelRename={() => setRenamingViewId(null)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          {isOverflowing && (
            <button
              ref={allViewsTriggerRef}
              type="button"
              onClick={() => setIsAllViewsOpen(true)}
              title="All views"
              aria-label="All views"
              className="focus-ring flex h-11 w-11 lg:h-7 lg:w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <DotsThree size={16} weight="bold" />
            </button>
          )}
          {addButton}
        </div>
      )}

      <ActionMenu
        open={isAllViewsOpen}
        onClose={() => setIsAllViewsOpen(false)}
        triggerRef={allViewsTriggerRef}
        label="All views"
        align="left"
        className="w-64"
      >
        {views.map((view) => (
          <ActionMenuItem
            key={view.id}
            aria-current={view.id === activeViewId ? "true" : undefined}
            className={cn(view.id === activeViewId && "bg-primary/10 text-primary")}
            onClick={() => {
              setIsAllViewsOpen(false);
              open(view.id);
            }}
          >
            <span className="text-muted-foreground">{VIEW_TYPE_ICONS[view.type]}</span>
            <span className="flex-1 truncate">{view.name}</span>
            {dirtyViewIds.includes(view.id) && (
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Unsaved changes" />
            )}
            {view.visibility === ViewVisibility.SHARED ? (
              <UsersThree size={12} className="text-subtle-foreground" />
            ) : (
              <LockSimple size={12} className="text-subtle-foreground" />
            )}
          </ActionMenuItem>
        ))}
      </ActionMenu>

      {menuView && (
        <ActionMenu
          open
          onClose={closeMenu}
          triggerRef={menuTriggerRef}
          label={`${menuView.name} options`}
          align="left"
        >
          <ViewMenuItems
            view={menuView}
            gates={gatesFor(menuView)}
            onRename={() => {
              closeMenu();
              if (compact) setRenamingInDialog(menuView);
              else setRenamingViewId(menuView.id);
            }}
            onDuplicate={() => {
              closeMenu();
              dispatch(duplicateView(project.id, menuView));
            }}
            onCopyLink={() => handleCopyLink(menuView)}
            onSetDefault={() => {
              closeMenu();
              dispatch(setDefaultView(project.id, menuView.id));
            }}
            onToggleVisibility={() => {
              closeMenu();
              dispatch(
                setViewVisibility(
                  project.id,
                  menuView.id,
                  menuView.visibility === ViewVisibility.SHARED
                    ? ViewVisibility.PERSONAL
                    : ViewVisibility.SHARED,
                ),
              );
            }}
            onDelete={() => {
              closeMenu();
              setDeletingView(menuView);
            }}
          />
        </ActionMenu>
      )}

      <ActionMenu
        open={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        triggerRef={addTriggerRef}
        label="New view"
        align="left"
      >
        {VIEW_TYPE_OPTIONS.map((option) => (
          <ActionMenuItem
            key={option.type}
            onClick={() => {
              setIsAddOpen(false);
              dispatch(createViewOfType(project.id, option.type));
            }}
          >
            <span className="text-muted-foreground">{option.icon}</span>
            {option.label}
          </ActionMenuItem>
        ))}
      </ActionMenu>

      {renamingInDialog && (
        <ViewNameDialog
          title="Rename view"
          initialName={renamingInDialog.name}
          submitLabel="Rename"
          onSubmit={(name) => dispatch(renameView(project.id, renamingInDialog.id, name))}
          onClose={() => setRenamingInDialog(null)}
        />
      )}

      <ConfirmDialog
        isOpen={deletingView !== null}
        onClose={() => setDeletingView(null)}
        onConfirm={handleDelete}
        title="Delete view"
        message={
          deletingView?.visibility === ViewVisibility.SHARED
            ? `Delete the shared view "${deletingView.name}"? Everyone on this project loses it.`
            : `Delete your view "${deletingView?.name ?? ""}"?`
        }
        confirmLabel="Delete"
        variant="danger"
        loading={isDeleting}
      />
    </>
  );
}

interface ViewTabProps {
  view: ViewConfig;
  isActive: boolean;
  isDirty: boolean;
  isDefault: boolean;
  showLabel: boolean;
  canReorder: boolean;
  isRenaming: boolean;
  onOpen: () => void;
  onOpenMenu: (trigger: HTMLButtonElement) => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
}

function ViewTab({
  view,
  isActive,
  isDirty,
  isDefault,
  showLabel,
  canReorder,
  isRenaming,
  onOpen,
  onOpenMenu,
  onRename,
  onCancelRename,
}: ViewTabProps) {
  const canDrag = canReorder && !isRenaming;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: view.id,
    disabled: !canDrag,
  });
  const shared = view.visibility === ViewVisibility.SHARED;
  const visibilityLabel = shared ? "Shared view" : "Personal view";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group flex shrink-0 items-center rounded-md text-sm transition-colors",
        isActive
          ? "bg-card text-foreground shadow-sm font-medium"
          : "text-muted-foreground hover:text-foreground",
        isDragging && "z-10 opacity-80",
      )}
      data-view-id={view.id}
      {...(canDrag ? { ...attributes, ...listeners } : {})}
      role="presentation"
    >
      {isRenaming ? (
        <Input
          autoFocus
          defaultValue={view.name}
          aria-label="View name"
          maxLength={100}
          className="h-7 w-40 px-1.5 text-xs"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") onRename(event.currentTarget.value);
            if (event.key === "Escape") onCancelRename();
          }}
          onBlur={(event) => onRename(event.currentTarget.value)}
        />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          aria-pressed={isActive}
          aria-label={showLabel ? undefined : view.name}
          onClick={onOpen}
          title={`${view.name} · ${visibilityLabel}${isDefault ? " · Project default" : ""}`}
          className="focus-ring flex min-h-11 min-w-11 lg:min-h-0 lg:min-w-0 items-center gap-1.5 rounded-md py-1 pl-2.5 pr-2"
        >
          <span className="flex shrink-0 items-center">{VIEW_TYPE_ICONS[view.type]}</span>
          {showLabel && <span className="max-w-40 truncate">{view.name}</span>}
          {showLabel && (
            <span
              className="flex shrink-0 items-center text-subtle-foreground"
              aria-label={visibilityLabel}
            >
              {shared ? <UsersThree size={12} /> : <LockSimple size={12} />}
            </span>
          )}
          {isDirty && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              role="img"
              aria-label="Unsaved changes"
              title="Unsaved changes"
            />
          )}
        </button>
      )}
      {isActive && !isRenaming && (
        <button
          type="button"
          onClick={(event) => onOpenMenu(event.currentTarget)}
          onPointerDown={(event) => event.stopPropagation()}
          title="View options"
          aria-label={`${view.name} options`}
          className="focus-ring mr-0.5 flex h-11 w-11 lg:h-6 lg:w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <CaretDown size={12} />
        </button>
      )}
    </div>
  );
}

interface ViewMenuItemsProps {
  view: ViewConfig;
  gates: ReturnType<typeof viewGates>;
  onRename: () => void;
  onDuplicate: () => void;
  onCopyLink: () => void;
  onSetDefault: () => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
}

/** Items the caller cannot use are left out; the backend still refuses them if called. */
function ViewMenuItems({
  view,
  gates,
  onRename,
  onDuplicate,
  onCopyLink,
  onSetDefault,
  onToggleVisibility,
  onDelete,
}: ViewMenuItemsProps) {
  const shared = view.visibility === ViewVisibility.SHARED;
  return (
    <>
      {gates.canEdit && (
        <ActionMenuItem onClick={onRename}>
          <PencilSimple size={16} />
          Rename
        </ActionMenuItem>
      )}
      <ActionMenuItem onClick={onDuplicate}>
        <Copy size={16} />
        Duplicate
      </ActionMenuItem>
      <ActionMenuItem onClick={onCopyLink}>
        <LinkSimple size={16} />
        Copy link
      </ActionMenuItem>
      {gates.canSetDefault && (
        <ActionMenuItem onClick={onSetDefault}>
          <PushPin size={16} />
          Set as project default
        </ActionMenuItem>
      )}
      {(shared ? gates.canMakePersonal : gates.canMakeShared) && (
        <ActionMenuItem onClick={onToggleVisibility}>
          {shared ? <LockSimple size={16} /> : <UsersThree size={16} />}
          {shared ? "Make personal" : "Make shared"}
        </ActionMenuItem>
      )}
      {gates.canEdit && (
        <>
          <ActionMenuSeparator />
          <ActionMenuItem destructive onClick={onDelete}>
            <Trash size={16} />
            Delete
          </ActionMenuItem>
        </>
      )}
    </>
  );
}
