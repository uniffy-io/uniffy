import { useRef, useState, type DragEvent } from "react";
import {
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  ArrowsInSimple,
  ArrowsOutSimple,
  Check,
  DotsSixVertical,
  Eye,
  EyeSlash,
  Funnel,
  Sliders,
  SquaresFour,
  X,
} from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { useProjectNames } from "@/features/dashboard/hooks/useProjectNames";
import { useProjectSearch } from "@/features/dashboard/hooks/useProjectSearch";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { MultiSelect } from "@/components/ui/multi-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import type {
  DashboardCatalog,
  DashboardWidget,
  PeopleScope,
  ProjectScope,
  SprintScope,
  WidgetFilters,
} from "@/features/dashboard/types";
import { FILTER_LABELS, describeFilters } from "@/features/dashboard/utils/layout";
import { cn } from "@/shared/utils/cn";

const iconButton =
  "focus-ring flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 lg:size-7";

interface DashboardActionsProps {
  catalog: DashboardCatalog | null;
  activePreset: string;
  hasPrevious: boolean;
  saving: boolean;
  onStartEditing: () => void;
  onApplyPreset: (presetId: string) => void;
  onShowEverything: () => void;
  onRestorePrevious: () => void;
}

/** Header controls: templates, restoring the layout a template replaced, and customizing. */
export function DashboardActions({
  catalog,
  activePreset,
  hasPrevious,
  saving,
  onStartEditing,
  onApplyPreset,
  onShowEverything,
  onRestorePrevious,
}: DashboardActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const trigger =
    "focus-ring flex min-h-11 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground lg:min-h-0";

  return (
    <div className="flex items-center gap-1">
      {catalog && catalog.presets.length > 0 && (
        <>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className={trigger}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="dashboard-templates"
          >
            <SquaresFour size={14} />
            Templates
          </button>
          <ActionMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            triggerRef={triggerRef}
            label="Templates"
            align="right"
            className="w-72"
          >
            <ActionMenuItem
              disabled={saving}
              onClick={() => {
                setMenuOpen(false);
                onShowEverything();
              }}
              className="items-start"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">Everything</span>
                <span className="text-xs text-muted-foreground">
                  Every widget, the default. Hide what you do not need in Customize.
                </span>
              </span>
            </ActionMenuItem>
            <ActionMenuSeparator />
            {catalog.presets.map((preset) => (
              <ActionMenuItem
                key={preset.id}
                disabled={saving}
                onClick={() => {
                  setMenuOpen(false);
                  onApplyPreset(preset.id);
                }}
                className="items-start"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-medium">
                    {preset.label}
                    {activePreset === preset.id && <Check size={12} className="text-primary" />}
                  </span>
                  <span className="text-xs text-muted-foreground">{preset.description}</span>
                </span>
              </ActionMenuItem>
            ))}
            {hasPrevious && (
              <>
                <ActionMenuSeparator />
                <ActionMenuItem
                  disabled={saving}
                  onClick={() => {
                    setMenuOpen(false);
                    onRestorePrevious();
                  }}
                >
                  <ArrowCounterClockwise size={14} />
                  Restore previous layout
                </ActionMenuItem>
              </>
            )}
          </ActionMenu>
        </>
      )}
      <button
        type="button"
        onClick={onStartEditing}
        className={trigger}
        data-testid="dashboard-customize"
      >
        <Sliders size={14} />
        Customize
      </button>
    </div>
  );
}

interface FilterEditorProps {
  label: string;
  filters: WidgetFilters;
  onClose: () => void;
  onSave: (filters: WidgetFilters) => void;
}

const PROJECT_OPTIONS = (Object.keys(FILTER_LABELS.projects) as ProjectScope[]).map((value) => ({
  value,
  label: FILTER_LABELS.projects[value],
}));
const PEOPLE_OPTIONS = (Object.keys(FILTER_LABELS.people) as PeopleScope[]).map((value) => ({
  value,
  content: FILTER_LABELS.people[value],
}));
const SPRINT_OPTIONS = (Object.keys(FILTER_LABELS.sprint) as SprintScope[]).map((value) => ({
  value,
  content: FILTER_LABELS.sprint[value],
}));

function FilterEditor({ label, filters, onClose, onSave }: FilterEditorProps) {
  const loaded = useAppSelector((state) => state.projects.projects);
  const [draft, setDraft] = useState<WidgetFilters>(filters);
  const [query, setQuery] = useState("");
  const hits = useProjectSearch(query);
  const pickedNames = useProjectNames(draft.projectIds);
  // Picked projects stay listed so their chips render; the rest come from the server search,
  // or from the loaded project list before anything is typed.
  const projectOptions = [
    ...draft.projectIds.map((id) => ({ value: id, label: pickedNames[id] ?? "Project" })),
    ...(query.trim()
      ? hits.map((hit) => ({ value: hit.id, label: hit.name }))
      : Object.values(loaded)
          .map((project) => ({ value: project.id, label: project.name }))
          .sort((a, b) => a.label.localeCompare(b.label))
    ).filter((option) => !draft.projectIds.includes(option.value)),
  ];
  const invalid = draft.projects === "selected" && draft.projectIds.length === 0;

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <ModalHeader
        title={`Filter ${label}`}
        description="Filters resolve for whoever opens the dashboard, so “Me” is always the viewer."
      />
      <ModalBody>
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-sm text-muted-foreground">Projects</p>
            <Select
              value={draft.projects}
              onChange={(projectsScope) => setDraft({ ...draft, projects: projectsScope })}
              options={PROJECT_OPTIONS}
              ariaLabel="Projects"
            />
            {draft.projects === "selected" && (
              <MultiSelect
                className="mt-2"
                value={draft.projectIds}
                onChange={(projectIds) => setDraft({ ...draft, projectIds })}
                options={projectOptions}
                placeholder="Pick projects"
                searchable
                searchPlaceholder="Search projects"
                onQueryChange={setQuery}
                ariaLabel="Selected projects"
              />
            )}
          </div>
          <div>
            <p className="mb-1 text-sm text-muted-foreground">Assigned to</p>
            <SegmentedControl
              value={draft.people}
              onChange={(people) => setDraft({ ...draft, people })}
              options={PEOPLE_OPTIONS}
              ariaLabel="Assigned to"
            />
          </div>
          <div>
            <p className="mb-1 text-sm text-muted-foreground">Sprint</p>
            <SegmentedControl
              value={draft.sprint}
              onChange={(sprint) => setDraft({ ...draft, sprint })}
              options={SPRINT_OPTIONS}
              ariaLabel="Sprint"
            />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={invalid}
          onClick={() => {
            onSave(draft);
            onClose();
          }}
        >
          Apply filters
        </Button>
      </ModalFooter>
    </Modal>
  );
}

interface DashboardCustomizerPanelProps {
  catalog: DashboardCatalog;
  dashboardName: string;
  onRename: (dashboardName: string) => void;
  widgets: DashboardWidget[];
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  onToggleVisibility: (id: string) => void;
  onToggleSize: (id: string) => void;
  onSetFilters: (id: string, filters: WidgetFilters) => void;
  onMove: (from: number, to: number) => void;
  onReset: () => void;
}

export function DashboardCustomizerPanel({
  catalog,
  dashboardName,
  onRename,
  widgets,
  saving,
  onCancel,
  onSave,
  onToggleVisibility,
  onToggleSize,
  onSetFilters,
  onMove,
  onReset,
}: DashboardCustomizerPanelProps) {
  const projectNames = useProjectNames(
    widgets.flatMap((widget) =>
      widget.filters.projects === "selected" ? widget.filters.projectIds : [],
    ),
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const types = new Map(catalog.widgets.map((type) => [type.id, type]));
  const editingWidget = widgets.find((widget) => widget.id === editing);

  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    if (dragIndex !== null) onMove(dragIndex, index);
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div
      className="space-y-3 rounded-xl bg-surface p-4 shadow-edge"
      data-testid="dashboard-customizer"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Customize dashboard</h3>
          <p className="text-xs text-subtle-foreground">
            Drag to reorder. Filters on project widgets count only work you can open.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>
            <ArrowCounterClockwise size={12} />
            Show everything
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            <X size={12} />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            loading={saving}
            data-testid="dashboard-customizer-save"
          >
            <Check size={12} />
            Save
          </Button>
        </div>
      </div>

      <div className="max-w-sm">
        <label htmlFor="dashboard-name" className="mb-1 block text-sm text-muted-foreground">
          Dashboard name (optional)
        </label>
        <Input
          id="dashboard-name"
          value={dashboardName}
          maxLength={80}
          placeholder="For example: Sprint review"
          onChange={(event) => onRename(event.target.value)}
          data-testid="dashboard-name-input"
        />
      </div>

      <ol className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {widgets.map((widget, index) => {
          const type = types.get(widget.id);
          if (!type) return null;
          const names = widget.filters.projectIds.flatMap((id) =>
            projectNames[id] ? [projectNames[id]] : [],
          );
          const summary = type.filterable ? describeFilters(widget.filters, names) : "";
          return (
            <li
              key={widget.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                setDragIndex(index);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setOverIndex(index);
              }}
              onDragLeave={() => setOverIndex((current) => (current === index ? null : current))}
              onDrop={(event) => onDrop(event, index)}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              data-testid={`dashboard-customizer-row-${widget.id}`}
              className={cn(
                "flex flex-wrap items-center gap-1 rounded-lg p-1.5 shadow-edge transition-shadow sm:flex-nowrap",
                widget.visible ? "bg-card" : "bg-muted/30 opacity-70",
                overIndex === index && dragIndex !== index && "shadow-edge-primary",
                dragIndex === index && "opacity-50",
              )}
            >
              <span className="hidden cursor-grab text-subtle-foreground lg:block" aria-hidden>
                <DotsSixVertical size={16} />
              </span>
              <div className="min-w-0 basis-full px-1 sm:basis-0 sm:flex-1">
                <p className="truncate text-xs font-medium">{type.label}</p>
                <p className="truncate text-[11px] text-subtle-foreground">
                  {summary || (type.filterable ? "All projects, everyone" : type.description)}
                </p>
              </div>
              <div className="ml-auto flex items-center">
                <button
                  type="button"
                  className={iconButton}
                  onClick={() => onMove(index, index - 1)}
                  disabled={index === 0}
                  title="Move up"
                  aria-label={`Move ${type.label} up`}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  onClick={() => onMove(index, index + 1)}
                  disabled={index === widgets.length - 1}
                  title="Move down"
                  aria-label={`Move ${type.label} down`}
                >
                  <ArrowDown size={12} />
                </button>
                {type.filterable && (
                  <button
                    type="button"
                    className={cn(iconButton, summary && "text-primary")}
                    onClick={() => setEditing(widget.id)}
                    title="Filters"
                    aria-label={`Filter ${type.label}`}
                  >
                    <Funnel size={12} weight={summary ? "fill" : "regular"} />
                  </button>
                )}
                <button
                  type="button"
                  className={iconButton}
                  onClick={() => onToggleSize(widget.id)}
                  title={widget.size === "expanded" ? "Make compact" : "Make wide"}
                  aria-label={`${widget.size === "expanded" ? "Compact" : "Widen"} ${type.label}`}
                >
                  {widget.size === "expanded" ? (
                    <ArrowsInSimple size={12} />
                  ) : (
                    <ArrowsOutSimple size={12} />
                  )}
                </button>
                <button
                  type="button"
                  className={iconButton}
                  onClick={() => onToggleVisibility(widget.id)}
                  title={widget.visible ? "Hide" : "Show"}
                  aria-label={`${widget.visible ? "Hide" : "Show"} ${type.label}`}
                  aria-pressed={widget.visible}
                >
                  {widget.visible ? <Eye size={12} /> : <EyeSlash size={12} />}
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {editingWidget && (
        <FilterEditor
          label={types.get(editingWidget.id)?.label ?? "widget"}
          filters={editingWidget.filters}
          onClose={() => setEditing(null)}
          onSave={(filters) => onSetFilters(editingWidget.id, filters)}
        />
      )}
    </div>
  );
}
