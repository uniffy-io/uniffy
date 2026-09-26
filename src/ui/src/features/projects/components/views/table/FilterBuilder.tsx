import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckSquare, Plus, Trash, Warning, X } from "@phosphor-icons/react";
import {
  FilterLogic,
  RelativeDateAnchor,
  TaskFilterOperator as Op,
} from "@uniffy/proto/projects/v1/projects_pb";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { MultiSelect } from "@/components/ui/multi-select";
import { NumberInput } from "@/components/ui/number-input";
import { popoverShellClass } from "@/components/ui/popover";
import { Select, type SelectOption } from "@/components/ui/select";
import { TagPicker } from "@/features/tags";
import { PersonFilterInput } from "@/features/projects/components/views/table/PersonFilterInput";
import { filterFieldOptions } from "@/features/projects/utils/filterFieldOptions";
import { useViewCatalog } from "@/features/projects/hooks/useViewCatalog";
import { selectTasksForProject } from "@/features/projects/store/projectsSlice";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import type { FieldDefinition } from "@/features/projects/types";
import type {
  ViewCatalog,
  ViewFieldCapabilities,
  ViewFieldRef,
  ViewFilterCondition,
  ViewFilterDate,
  ViewFilterGroup,
  ViewFilterIdSet,
  ViewFilterValue,
  ViewIdFlag,
} from "@/features/projects/types/views";
import { TASK_TYPES } from "@/features/projects/utils/taskTypes";
import {
  FILTER_PRESETS,
  NO_ID_SET,
  appendChild,
  conditionProblem,
  countNodes,
  editorGroup,
  fromEditorTree,
  filterTreeLimitProblem,
  mapNode,
  removeNode,
  toEditorTree,
  withPreset,
  type EditorGroup,
  type EditorNode,
} from "@/features/projects/utils/filterTree";
import {
  EMPTINESS_OPERATORS,
  ID_KINDS,
  OPERATOR_LABELS,
  SINGLE_ID_OPERATORS,
  capabilitiesOf,
  fieldKindOf,
  fieldRefFromKey,
  fieldRefKey,
  fieldRefLabel,
  type FieldKind,
} from "@/features/projects/utils/viewFields";
import { randomUUID } from "@/shared/utils/uuid";

interface FilterBuilderProps {
  projectId: string;
  fields: FieldDefinition[];
  filter: ViewFilterGroup | null;
  onApply: (filter: ViewFilterGroup | null) => void;
  onClose: () => void;
  /** Placement overrides when the popover anchors to something other than its trigger. */
  className?: string;
}

/** Operators in reading order: equality, sets, comparisons, emptiness last. */
const OPERATOR_ORDER: readonly Op[] = [
  Op.IS,
  Op.IS_NOT,
  Op.IS_ANY_OF,
  Op.IS_NONE_OF,
  Op.IS_ALL_OF,
  Op.CONTAINS,
  Op.NOT_CONTAINS,
  Op.GREATER_THAN,
  Op.LESS_THAN,
  Op.BEFORE,
  Op.AFTER,
  Op.ON_OR_BEFORE,
  Op.ON_OR_AFTER,
  Op.BETWEEN,
  Op.IS_EMPTY,
  Op.IS_NOT_EMPTY,
];

type DateMode =
  | "fixed"
  | "today"
  | "yesterday"
  | "tomorrow"
  | "startOfWeek"
  | "endOfWeek"
  | "startOfMonth"
  | "endOfMonth";

const DATE_MODES: SelectOption<DateMode>[] = [
  { value: "fixed", label: "Exact date" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "startOfWeek", label: "Start of week" },
  { value: "endOfWeek", label: "End of week" },
  { value: "startOfMonth", label: "Start of month" },
  { value: "endOfMonth", label: "End of month" },
];

const MODE_DATES: Record<Exclude<DateMode, "fixed">, [RelativeDateAnchor, number]> = {
  today: [RelativeDateAnchor.TODAY, 0],
  yesterday: [RelativeDateAnchor.TODAY, -1],
  tomorrow: [RelativeDateAnchor.TODAY, 1],
  startOfWeek: [RelativeDateAnchor.START_OF_WEEK, 0],
  endOfWeek: [RelativeDateAnchor.END_OF_WEEK, 0],
  startOfMonth: [RelativeDateAnchor.START_OF_MONTH, 0],
  endOfMonth: [RelativeDateAnchor.END_OF_MONTH, 0],
};

function dateModeOf(date: ViewFilterDate): DateMode {
  if (date.kind === "fixed") return "fixed";
  const match = (Object.keys(MODE_DATES) as Exclude<DateMode, "fixed">[]).find(
    (mode) => MODE_DATES[mode][0] === date.anchor && MODE_DATES[mode][1] === date.offsetDays,
  );
  if (match) return match;
  return (
    (Object.keys(MODE_DATES) as Exclude<DateMode, "fixed">[]).find(
      (mode) => MODE_DATES[mode][0] === date.anchor && MODE_DATES[mode][1] === 0,
    ) ?? "today"
  );
}

/** Flags a non-person id field offers as options, with the word each reads as. */
const FLAG_LABELS: Record<ViewIdFlag, (kind: FieldKind) => string> = {
  includeCurrentUser: () => "Me",
  includeActiveSprint: () => "Active sprint",
  includeEmpty: (kind) =>
    kind === "sprint"
      ? "Backlog"
      : kind === "tags"
        ? "Untagged"
        : kind === "epic"
          ? "No epic"
          : kind === "task_ref"
            ? "No parent"
            : kind === "task_ref_set"
              ? "Not blocked by anything"
              : "No value",
};

const FLAG_PREFIX = "__flag:";

/** The order flags are offered in: the viewer, then the active sprint, then "none". */
const FLAG_ORDER: readonly ViewIdFlag[] = [
  "includeCurrentUser",
  "includeActiveSprint",
  "includeEmpty",
];

function orderedOperators(capabilities: ViewFieldCapabilities | null): Op[] {
  const allowed = new Set(capabilities?.operators ?? []);
  return OPERATOR_ORDER.filter((operator) => allowed.has(operator));
}

function defaultOperator(capabilities: ViewFieldCapabilities | null): Op | null {
  const operators = orderedOperators(capabilities);
  if (operators.includes(Op.IS_ANY_OF)) return Op.IS_ANY_OF;
  if (operators.includes(Op.CONTAINS)) return Op.CONTAINS;
  return operators.find((operator) => !EMPTINESS_OPERATORS.has(operator)) ?? operators[0] ?? null;
}

function blankValue(kind: FieldKind, operator: Op): ViewFilterValue | null {
  if (EMPTINESS_OPERATORS.has(operator)) return null;
  if (ID_KINDS.has(kind)) return { kind: "ids", ids: NO_ID_SET };
  if (kind === "boolean") return { kind: "flag", flag: true };
  return null;
}

const CONTROL = "h-11 md:h-7 touch:h-11";

export function FilterBuilder({
  projectId,
  fields,
  filter,
  onApply,
  onClose,
  className,
}: FilterBuilderProps) {
  const { isMobile } = useBreakpoint();
  const catalog = useViewCatalog();
  const containerRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<EditorGroup>(() => toEditorTree(filter));
  const [additionProblem, setAdditionProblem] = useState<string | null>(null);
  const fieldsById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const limitProblem = catalog ? filterTreeLimitProblem(root, catalog.filterLimits) : null;

  const changeRoot = (next: EditorGroup) => {
    setAdditionProblem(null);
    setRoot(next);
  };
  const addToRoot = (next: EditorGroup) => {
    if (!catalog) return;
    const problem = filterTreeLimitProblem(next, catalog.filterLimits);
    if (problem) {
      setAdditionProblem(problem);
      return;
    }
    changeRoot(next);
  };

  useEffect(() => {
    if (isMobile) return;
    const handleClickOutside = (e: MouseEvent) => {
      // Pickers render in body portals; a pick there must not discard the draft.
      if (e.target instanceof Element && e.target.closest("[data-select-portal]")) return;
      // The trigger toggles the builder itself; closing here would reopen it on the click.
      if (e.target instanceof Element && e.target.closest("[data-filter-trigger]")) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMobile, onClose]);

  const handleApply = () => {
    if (!catalog || limitProblem) return;
    onApply(fromEditorTree(root, catalog.filterLimits));
    onClose();
  };

  const handleClear = () => {
    onApply(null);
    onClose();
  };

  const body = catalog ? (
    <div className="space-y-3">
      {(additionProblem || limitProblem) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {additionProblem || limitProblem}
        </p>
      )}
      <FilterEditor
        projectId={projectId}
        fields={fields}
        fieldsById={fieldsById}
        catalog={catalog}
        root={root}
        onChange={changeRoot}
        onAdd={addToRoot}
      />
    </div>
  ) : (
    <p className="text-sm text-muted-foreground py-4 text-center">Loading filters...</p>
  );

  const actions = (
    <>
      {filter && (
        <Button
          variant="ghost"
          size="sm"
          className="h-11 md:h-7 touch:h-11 text-xs text-muted-foreground"
          onClick={handleClear}
        >
          Clear all
        </Button>
      )}
      <Button
        size="sm"
        className="h-11 md:h-7 touch:h-11 text-xs"
        onClick={handleApply}
        disabled={!catalog || limitProblem !== null}
      >
        Apply
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <Modal onClose={onClose} anchor="top" maxWidth="max-w-lg">
        <ModalHeader title="Filter tasks" onClose={onClose} />
        <ModalBody scrollable={false} className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          {body}
        </ModalBody>
        <ModalFooter className="px-4 py-3">{actions}</ModalFooter>
      </Modal>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        popoverShellClass,
        "absolute top-full right-0 z-50 mt-2 w-[min(680px,calc(100vw-2rem))]",
        className,
      )}
    >
      <div className="p-3 border-b border-border/60">
        <span className="text-sm font-medium text-foreground">Filter tasks</span>
      </div>
      <div className="p-3 max-h-[min(460px,60dvh)] overflow-y-auto">{body}</div>
      <div className="flex items-center justify-end gap-2 p-3 border-t border-border/60">
        {actions}
      </div>
    </div>
  );
}

interface EditorContext {
  projectId: string;
  fieldsById: ReadonlyMap<string, FieldDefinition>;
  catalog: ViewCatalog;
  fieldOptions: SelectOption[];
  canAddNode: boolean;
  update: (id: string, next: (node: EditorNode) => EditorNode) => void;
  remove: (id: string) => void;
  add: (groupId: string, node: EditorNode) => void;
  newCondition: () => EditorNode | null;
}

function FilterEditor({
  projectId,
  fields,
  fieldsById,
  catalog,
  root,
  onChange,
  onAdd,
}: {
  projectId: string;
  fields: FieldDefinition[];
  fieldsById: ReadonlyMap<string, FieldDefinition>;
  catalog: ViewCatalog;
  root: EditorGroup;
  onChange: (root: EditorGroup) => void;
  onAdd: (root: EditorGroup) => void;
}) {
  const fieldOptions = useMemo(
    () => filterFieldOptions(fields, fieldsById, catalog),
    [fields, fieldsById, catalog],
  );

  const newCondition = (): EditorNode | null => {
    const key = fieldOptions[0]?.value;
    const ref = key ? fieldRefFromKey(key) : null;
    const condition = ref ? conditionFor(ref, fieldsById, catalog) : null;
    return condition ? { id: randomUUID(), kind: "condition", condition } : null;
  };

  const context: EditorContext = {
    projectId,
    fieldsById,
    catalog,
    fieldOptions,
    canAddNode: countNodes(root) < catalog.filterLimits.maxNodes,
    update: (id, next) => onChange(mapNode(root, id, next)),
    remove: (id) => onChange(removeNode(root, id)),
    add: (groupId, node) => onAdd(appendChild(root, groupId, node)),
    newCondition,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">Presets</span>
        {FILTER_PRESETS.map(({ preset, label }) => (
          <button
            key={preset}
            type="button"
            disabled={!context.canAddNode}
            onClick={() => onAdd(withPreset(root, preset))}
            className="h-11 md:h-6 touch:h-11 px-2.5 rounded-full text-xs bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
      <GroupEditor group={root} depth={1} context={context} />
    </div>
  );
}

function conditionFor(
  ref: ViewFieldRef,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
  catalog: ViewCatalog,
): ViewFilterCondition | null {
  const kind = fieldKindOf(ref, fieldsById);
  const operator = defaultOperator(capabilitiesOf(ref, fieldsById, catalog));
  if (!kind || operator === null) return null;
  return { field: ref, operator, value: blankValue(kind, operator) };
}

function GroupEditor({
  group,
  depth,
  context,
  onRemove,
}: {
  group: EditorGroup;
  depth: number;
  context: EditorContext;
  onRemove?: () => void;
}) {
  const nested = depth > 1;
  const canNest = depth < context.catalog.filterLimits.maxDepth;
  const toggleLogic = () =>
    context.update(group.id, (node) =>
      node.kind === "group"
        ? { ...node, logic: node.logic === FilterLogic.OR ? FilterLogic.AND : FilterLogic.OR }
        : node,
    );

  return (
    <div className={cn("space-y-2", nested && "rounded-lg bg-muted/40 p-1.5 md:p-2")}>
      {nested && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {group.logic === FilterLogic.OR ? "Any of these" : "All of these"}
          </span>
          <button
            type="button"
            onClick={onRemove}
            className="h-11 w-11 md:h-6 md:w-6 touch:h-11 touch:w-11 inline-flex items-center justify-center rounded hover:bg-muted transition-colors"
            title="Remove group"
          >
            <Trash size={12} className="text-muted-foreground" />
          </button>
        </div>
      )}

      {group.children.length === 0 && (
        <p className="text-sm text-muted-foreground py-2 text-center">
          {nested
            ? "An empty group matches every task."
            : "No filters applied. Add a condition or pick a preset."}
        </p>
      )}

      {group.children.map((child, index) => (
        <div key={child.id} className="flex items-start gap-2">
          {index === 0 ? (
            <span className="w-11 md:w-12 pt-3 md:pt-1.5 text-xs text-muted-foreground text-right shrink-0">
              Where
            </span>
          ) : (
            <button
              type="button"
              onClick={toggleLogic}
              className="w-11 md:w-12 h-11 md:h-7 touch:h-11 text-xs font-medium text-primary text-right shrink-0 hover:underline"
              title="Switch between and / or for this group"
            >
              {group.logic === FilterLogic.OR ? "or" : "and"}
            </button>
          )}
          <div className="flex-1 min-w-0">
            {child.kind === "group" ? (
              <GroupEditor
                group={child}
                depth={depth + 1}
                context={context}
                onRemove={() => context.remove(child.id)}
              />
            ) : (
              <ConditionRow
                condition={child.condition}
                context={context}
                onChange={(condition) => context.update(child.id, () => ({ ...child, condition }))}
                onRemove={() => context.remove(child.id)}
              />
            )}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-1 pl-13 md:pl-14">
        <Button
          variant="ghost"
          size="sm"
          className="h-11 md:h-7 touch:h-11 text-xs"
          disabled={!context.canAddNode}
          onClick={() => {
            const node = context.newCondition();
            if (node) context.add(group.id, node);
          }}
        >
          <Plus size={12} className="mr-1" />
          Add condition
        </Button>
        {canNest && (
          <Button
            variant="ghost"
            size="sm"
            className="h-11 md:h-7 touch:h-11 text-xs"
            disabled={!context.canAddNode}
            onClick={() => {
              const node = context.newCondition();
              context.add(
                group.id,
                editorGroup(
                  group.logic === FilterLogic.OR ? FilterLogic.AND : FilterLogic.OR,
                  node ? [node] : [],
                ),
              );
            }}
          >
            <Plus size={12} className="mr-1" />
            Add group
          </Button>
        )}
      </div>
    </div>
  );
}

function ConditionRow({
  condition,
  context,
  onChange,
  onRemove,
}: {
  condition: ViewFilterCondition;
  context: EditorContext;
  onChange: (condition: ViewFilterCondition) => void;
  onRemove: () => void;
}) {
  const { fieldsById, catalog } = context;
  const kind = fieldKindOf(condition.field, fieldsById);
  const capabilities = capabilitiesOf(condition.field, fieldsById, catalog);
  const operators = orderedOperators(capabilities);
  const key = fieldRefKey(condition.field);
  const problem = conditionProblem(condition, fieldsById);
  const fieldOptions = context.fieldOptions.some((option) => option.value === key)
    ? context.fieldOptions
    : [
        ...context.fieldOptions,
        {
          value: key,
          label: fieldRefLabel(condition.field, fieldsById),
          icon: <Warning size={14} className="text-red-600 dark:text-red-400 shrink-0" />,
        },
      ];

  const changeField = (nextKey: string) => {
    const ref = fieldRefFromKey(nextKey);
    const next = ref ? conditionFor(ref, fieldsById, catalog) : null;
    if (next) onChange(next);
  };

  const changeOperator = (operator: Op) => {
    if (!kind) return;
    const keepsValue =
      !EMPTINESS_OPERATORS.has(operator) &&
      !EMPTINESS_OPERATORS.has(condition.operator) &&
      (operator === Op.BETWEEN) === (condition.operator === Op.BETWEEN) &&
      SINGLE_ID_OPERATORS.has(operator) === SINGLE_ID_OPERATORS.has(condition.operator);
    onChange({
      ...condition,
      operator,
      value: keepsValue ? condition.value : blankValue(kind, operator),
    });
  };

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "flex flex-wrap md:flex-nowrap items-start gap-1.5",
          problem && "rounded-md ring-1 ring-red-500/60 p-1",
        )}
      >
        <Select
          value={key}
          options={fieldOptions}
          onChange={changeField}
          size="sm"
          searchable
          searchPlaceholder="Search fields..."
          menuMinWidth={200}
          className="w-[calc(100%-3.25rem)] md:w-40 shrink-0"
          triggerClassName={cn(CONTROL, "w-full min-w-0")}
          ariaLabel="Field"
        />
        <button
          type="button"
          onClick={onRemove}
          className="h-11 w-11 inline-flex items-center justify-center rounded hover:bg-muted transition-colors shrink-0 md:hidden"
          title="Remove condition"
        >
          <X size={12} className="text-muted-foreground" />
        </button>
        <Select
          value={operators.includes(condition.operator) ? condition.operator : undefined}
          options={operators.map((operator) => ({
            value: operator,
            label: OPERATOR_LABELS.get(operator) ?? "",
          }))}
          onChange={changeOperator}
          size="sm"
          placeholder="Operator"
          className="w-full md:w-32 shrink-0"
          triggerClassName={cn(CONTROL, "w-full min-w-0")}
          ariaLabel="Operator"
        />
        {kind && !EMPTINESS_OPERATORS.has(condition.operator) ? (
          <div className="w-full md:w-auto md:flex-1 min-w-0">
            <ConditionValueInput
              kind={kind}
              condition={condition}
              capabilities={capabilities}
              context={context}
              onChange={(value) => onChange({ ...condition, value })}
            />
          </div>
        ) : (
          <span className="hidden md:block flex-1" />
        )}
        <button
          type="button"
          onClick={onRemove}
          className="hidden md:inline-flex h-7 w-7 touch:h-11 touch:w-11 items-center justify-center rounded hover:bg-muted transition-colors shrink-0"
          title="Remove condition"
        >
          <X size={12} className="text-muted-foreground" />
        </button>
      </div>
      {problem && (
        <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <Warning size={12} className="shrink-0" />
          {problem}
        </p>
      )}
    </div>
  );
}

function ConditionValueInput({
  kind,
  condition,
  capabilities,
  context,
  onChange,
}: {
  kind: FieldKind;
  condition: ViewFilterCondition;
  capabilities: ViewFieldCapabilities | null;
  context: EditorContext;
  onChange: (value: ViewFilterValue | null) => void;
}) {
  const { operator, value } = condition;
  const limits = context.catalog.filterLimits;

  if (ID_KINDS.has(kind)) {
    return (
      <IdValueInput
        kind={kind}
        condition={condition}
        flags={capabilities?.idFlags ?? []}
        context={context}
        set={value?.kind === "ids" ? value.ids : NO_ID_SET}
        onChange={(ids) => onChange({ kind: "ids", ids })}
      />
    );
  }

  if (kind === "boolean") {
    return (
      <Select
        value={value?.kind === "flag" && !value.flag ? "no" : "yes"}
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        onChange={(choice) => onChange({ kind: "flag", flag: choice === "yes" })}
        size="sm"
        triggerClassName={cn(CONTROL, "w-full")}
        ariaLabel="Value"
      />
    );
  }

  if (kind === "number") {
    const numberInput = (current: number, placeholder: string, set: (next: number) => void) => (
      <NumberInput
        value={Number.isFinite(current) ? String(current) : ""}
        onChange={(e) => set(e.target.value ? Number(e.target.value) : NaN)}
        placeholder={placeholder}
        className={cn(CONTROL, "px-2 text-xs flex-1 min-w-0")}
      />
    );
    if (operator === Op.BETWEEN) {
      const range = value?.kind === "numberRange" ? value : { min: NaN, max: NaN };
      return (
        <div className="flex items-center gap-1">
          {numberInput(range.min, "Min", (min) =>
            onChange({ kind: "numberRange", min, max: range.max }),
          )}
          <span className="text-xs text-muted-foreground">and</span>
          {numberInput(range.max, "Max", (max) =>
            onChange({ kind: "numberRange", min: range.min, max }),
          )}
        </div>
      );
    }
    return numberInput(value?.kind === "number" ? value.number : NaN, "Value...", (number) =>
      onChange(Number.isFinite(number) ? { kind: "number", number } : null),
    );
  }

  if (kind === "date" || kind === "timestamp") {
    if (operator === Op.BETWEEN) {
      const start: ViewFilterDate =
        value?.kind === "dateRange" ? value.start : { kind: "fixed", date: "" };
      const end: ViewFilterDate =
        value?.kind === "dateRange" ? value.end : { kind: "fixed", date: "" };
      return (
        <div className="space-y-1">
          <DateValueInput
            date={start}
            maxOffset={limits.maxRelativeOffsetDays}
            onChange={(next) => onChange({ kind: "dateRange", start: next, end })}
          />
          <DateValueInput
            date={end}
            prefix="and"
            maxOffset={limits.maxRelativeOffsetDays}
            onChange={(next) => onChange({ kind: "dateRange", start, end: next })}
          />
        </div>
      );
    }
    return (
      <DateValueInput
        date={value?.kind === "date" ? value.date : { kind: "fixed", date: "" }}
        maxOffset={limits.maxRelativeOffsetDays}
        onChange={(date) => onChange({ kind: "date", date })}
      />
    );
  }

  return (
    <Input
      type="text"
      value={value?.kind === "text" ? value.text : ""}
      maxLength={limits.maxTextLength}
      onChange={(e) => onChange(e.target.value ? { kind: "text", text: e.target.value } : null)}
      placeholder="Value..."
      className={cn(CONTROL, "px-2 text-xs w-full")}
    />
  );
}

function DateValueInput({
  date,
  prefix,
  maxOffset,
  onChange,
}: {
  date: ViewFilterDate;
  prefix?: ReactNode;
  maxOffset: number;
  onChange: (date: ViewFilterDate) => void;
}) {
  const mode = dateModeOf(date);
  return (
    <div className="flex items-center gap-1 min-w-0">
      {prefix && <span className="text-xs text-muted-foreground w-7 shrink-0">{prefix}</span>}
      <Select
        value={mode}
        options={DATE_MODES}
        onChange={(next) => {
          if (next === "fixed") {
            onChange({ kind: "fixed", date: "" });
            return;
          }
          const [anchor, offsetDays] = MODE_DATES[next];
          onChange({ kind: "relative", anchor, offsetDays });
        }}
        size="sm"
        className="w-32 min-w-0 shrink"
        triggerClassName={cn(CONTROL, "w-full min-w-0")}
        ariaLabel="Date"
      />
      {date.kind === "fixed" ? (
        <DatePicker
          value={date.date}
          onChange={(next) => onChange({ kind: "fixed", date: next })}
          size="sm"
          triggerClassName={CONTROL}
          className="flex-1 min-w-0"
        />
      ) : (
        <NumberInput
          value={date.offsetDays === 0 ? "" : String(date.offsetDays)}
          onChange={(e) => {
            const raw = e.target.value ? Math.trunc(Number(e.target.value)) : 0;
            const offsetDays = Math.max(-maxOffset, Math.min(maxOffset, raw || 0));
            onChange({ ...date, offsetDays });
          }}
          placeholder="± days"
          title="Days after (or, negative, before) the date picked"
          className={cn(CONTROL, "px-2 text-xs w-16 min-w-0 shrink")}
        />
      )}
    </div>
  );
}

function IdValueInput({
  kind,
  condition,
  flags,
  context,
  set,
  onChange,
}: {
  kind: FieldKind;
  condition: ViewFilterCondition;
  flags: readonly ViewIdFlag[];
  context: EditorContext;
  set: ViewFilterIdSet;
  onChange: (set: ViewFilterIdSet) => void;
}) {
  const { projectId, fieldsById } = context;
  const selectProjectTasks = useMemo(() => selectTasksForProject(projectId), [projectId]);
  const tasks = useAppSelector(selectProjectTasks);
  const sprints = useAppSelector(selectSprintsForProject(projectId));
  const single = SINGLE_ID_OPERATORS.has(condition.operator);
  // "Is all of" a set that includes empty is contradictory; the server refuses it.
  const usableFlags = FLAG_ORDER.filter(
    (flag) =>
      flags.includes(flag) && !(flag === "includeEmpty" && condition.operator === Op.IS_ALL_OF),
  );

  if (kind === "person" || kind === "single_person") {
    return <PersonFilterInput set={set} flags={usableFlags} single={single} onChange={onChange} />;
  }

  if (kind === "tags") {
    const untagged = usableFlags.includes("includeEmpty");
    return (
      <div className="flex items-start gap-1">
        <div className="flex-1 min-w-0">
          <TagPicker
            selectedTagIds={set.ids}
            onChange={(ids) => onChange({ ...set, ids })}
            placeholder="Pick tags"
          />
        </div>
        {untagged && (
          <button
            type="button"
            onClick={() => onChange({ ...set, includeEmpty: !set.includeEmpty })}
            className={cn(
              "h-11 md:h-7 touch:h-11 px-2 rounded-md text-xs shrink-0 transition-colors",
              set.includeEmpty
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            Untagged
          </button>
        )}
      </div>
    );
  }

  let options: SelectOption[] = [];
  if (kind === "single_select" || kind === "multi_select") {
    const field =
      condition.field.kind === "field" ? fieldsById.get(condition.field.fieldId) : undefined;
    options = (field?.config.options ?? []).map((option) => ({
      value: option.id,
      label: option.label,
      icon: (
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: option.color }} />
      ),
    }));
  } else if (kind === "task_type") {
    options = TASK_TYPES.map((type) => ({ value: type.value, label: type.label }));
  } else if (kind === "sprint") {
    options = sprints.map((sprint) => ({ value: sprint.id, label: sprint.name }));
  } else if (kind === "epic") {
    options = tasks
      .filter((task) => task.taskType === "epic")
      .map((task) => ({ value: task.id, label: task.title }));
  } else {
    options = tasks.map((task) => ({
      value: task.id,
      label: task.number ? `#${task.number} ${task.title}` : task.title,
      icon: <CheckSquare size={12} className="text-muted-foreground shrink-0" />,
    }));
  }
  const flagOptions: SelectOption[] = usableFlags.map((flag) => ({
    value: `${FLAG_PREFIX}${flag}`,
    label: FLAG_LABELS[flag](kind),
  }));
  const allOptions = [...flagOptions, ...options];
  const searchable = allOptions.length > 8;

  const picked = [
    ...usableFlags.filter((flag) => set[flag]).map((flag) => `${FLAG_PREFIX}${flag}`),
    ...set.ids,
  ];
  const toSet = (values: string[]): ViewFilterIdSet => {
    const next: ViewFilterIdSet = { ...NO_ID_SET, ids: [] };
    for (const entry of values) {
      if (entry.startsWith(FLAG_PREFIX)) next[entry.slice(FLAG_PREFIX.length) as ViewIdFlag] = true;
      else next.ids.push(entry);
    }
    return next;
  };

  if (single) {
    return (
      <Select
        value={picked[0]}
        options={allOptions}
        onChange={(entry) => onChange(toSet([entry]))}
        size="sm"
        searchable={searchable}
        menuMinWidth={220}
        placeholder="Select..."
        className="w-full"
        triggerClassName={cn(CONTROL, "w-full min-w-0")}
        ariaLabel="Value"
      />
    );
  }

  return (
    <MultiSelect
      value={picked}
      options={allOptions}
      onChange={(values) => onChange(toSet(values))}
      size="sm"
      searchable={searchable}
      placeholder="Select..."
      className="w-full"
      triggerClassName="min-h-11 md:min-h-7 touch:min-h-11 py-0.5"
      ariaLabel="Values"
    />
  );
}
