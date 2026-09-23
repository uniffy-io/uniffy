import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Plus, X, CaretDown, Check } from "@phosphor-icons/react";
import {
  FilterLogic,
  RelativeDateAnchor,
  TaskFilterOperator as Op,
} from "@uniffy/proto/projects/v1/projects_pb";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input, controlShellClass } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { popoverShellClass } from "@/components/ui/popover";
import { TagPicker } from "@/features/tags";
import { PersonFilterInput } from "@/features/projects/components/views/table/PersonFilterInput";
import { selectTasksForProject } from "@/features/projects/store/projectsSlice";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { FieldDefinition } from "@/features/projects/types";
import type {
  ViewFieldRef,
  ViewFilterCondition,
  ViewFilterDate,
  ViewFilterGroup,
  ViewFilterIdSet,
  ViewFilterNode,
  ViewFilterValue,
} from "@/features/projects/types/views";
import { TASK_TYPES } from "@/features/projects/utils/taskTypes";
import {
  EMPTINESS_OPERATORS,
  FILTERABLE_PSEUDO_FIELDS,
  ID_FLAGS,
  ID_KINDS,
  OPERATOR_LABELS,
  SINGLE_ID_OPERATORS,
  fieldKindOf,
  fieldRef,
  fieldRefFromKey,
  fieldRefKey,
  fieldRefLabel,
  operatorsFor,
  pseudoRef,
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

interface Row {
  id: string;
  node: ViewFilterNode;
}

interface Choice {
  value: string;
  label: string;
  color?: string;
}

const ACTIVE_SPRINT_CHOICE = "__active_sprint__";

const DATE_MODES: Choice[] = [
  { value: "fixed", label: "Exact date" },
  { value: String(RelativeDateAnchor.TODAY), label: "Today" },
  { value: String(RelativeDateAnchor.START_OF_WEEK), label: "Start of week" },
  { value: String(RelativeDateAnchor.END_OF_WEEK), label: "End of week" },
  { value: String(RelativeDateAnchor.START_OF_MONTH), label: "Start of month" },
  { value: String(RelativeDateAnchor.END_OF_MONTH), label: "End of month" },
];

const NO_ID_SET: ViewFilterIdSet = {
  ids: [],
  includeCurrentUser: false,
  includeEmpty: false,
  includeActiveSprint: false,
};

function toRows(filter: ViewFilterGroup | null): Row[] {
  return (filter?.nodes ?? []).map((node) => ({ id: randomUUID(), node }));
}

function blankValue(kind: FieldKind, operator: Op): ViewFilterValue | null {
  if (EMPTINESS_OPERATORS.has(operator)) return null;
  if (ID_KINDS.has(kind)) return { kind: "ids", ids: NO_ID_SET };
  if (kind === "boolean") return { kind: "flag", flag: true };
  return null;
}

function idCount(set: ViewFilterIdSet): number {
  return (
    set.ids.length +
    Number(set.includeCurrentUser) +
    Number(set.includeEmpty) +
    Number(set.includeActiveSprint)
  );
}

function isDateComplete(date: ViewFilterDate): boolean {
  return date.kind === "relative" || /^\d{4}-\d{2}-\d{2}$/.test(date.date);
}

/** Incomplete rows stay in the editor but never reach the view: the backend would refuse them. */
function isComplete(condition: ViewFilterCondition): boolean {
  if (EMPTINESS_OPERATORS.has(condition.operator)) return condition.value === null;
  const value = condition.value;
  if (!value) return false;
  switch (value.kind) {
    case "ids": {
      const count = idCount(value.ids);
      return SINGLE_ID_OPERATORS.has(condition.operator) ? count === 1 : count > 0;
    }
    case "text":
      return value.text.trim().length > 0;
    case "number":
      return Number.isFinite(value.number);
    case "numberRange":
      return Number.isFinite(value.min) && Number.isFinite(value.max) && value.min <= value.max;
    case "date":
      return isDateComplete(value.date);
    case "dateRange":
      return isDateComplete(value.start) && isDateComplete(value.end);
    case "flag":
      return true;
  }
}

export function FilterBuilder({
  projectId,
  fields: rawFields,
  filter,
  onApply,
  onClose,
  className,
}: FilterBuilderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Row[]>(() => toRows(filter));
  const [logic, setLogic] = useState<FilterLogic>(filter?.logic ?? FilterLogic.AND);

  const fields = useMemo(
    () => rawFields.filter((field) => field.id !== SYSTEM_FIELD_IDS.TITLE),
    [rawFields],
  );
  const fieldsById = useMemo(
    () => new Map(rawFields.map((field) => [field.id, field])),
    [rawFields],
  );
  const fieldChoices: Choice[] = useMemo(
    () => [
      ...fields.map((field) => ({ value: fieldRefKey(fieldRef(field.id)), label: field.name })),
      ...FILTERABLE_PSEUDO_FIELDS.map((pseudo) => ({
        value: fieldRefKey(pseudoRef(pseudo)),
        label: fieldRefLabel(pseudoRef(pseudo), fieldsById),
      })),
    ],
    [fields, fieldsById],
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Pickers render in body portals; a pick there must not discard the draft.
      if (e.target instanceof Element && e.target.closest("[data-select-portal]")) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const conditionFor = (ref: ViewFieldRef): ViewFilterCondition | null => {
    const kind = fieldKindOf(ref, fieldsById);
    if (!kind) return null;
    const operator = operatorsFor(kind, ref)[0];
    return { field: ref, operator, value: blankValue(kind, operator) };
  };

  const addCondition = () => {
    const first = fields[0] ? fieldRef(fields[0].id) : pseudoRef(FILTERABLE_PSEUDO_FIELDS[0]);
    const condition = conditionFor(first);
    if (condition) {
      setRows([...rows, { id: randomUUID(), node: { kind: "condition", condition } }]);
    }
  };

  const updateCondition = (id: string, condition: ViewFilterCondition) => {
    setRows(
      rows.map((row) => (row.id === id ? { id, node: { kind: "condition", condition } } : row)),
    );
  };

  const handleApply = () => {
    const nodes = rows
      .map((row) => row.node)
      .filter((node) => node.kind === "group" || isComplete(node.condition));
    onApply(nodes.length === 0 ? null : { logic, nodes });
    onClose();
  };

  const handleClear = () => {
    onApply(null);
    onClose();
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        popoverShellClass,
        "absolute top-full right-0 z-50 mt-2 w-[min(560px,calc(100vw-2rem))]",
        className,
      )}
    >
      <div className="p-3 border-b border-border/60">
        <span className="text-sm font-medium text-foreground">Filter tasks</span>
      </div>

      <div className="p-3 space-y-2 max-h-[320px] overflow-y-auto">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-2 text-center">
            No filters applied. Add a condition to filter tasks.
          </p>
        )}

        {rows.map((row, index) => (
          <div key={row.id} className="flex items-center gap-2">
            {index === 0 ? (
              <span className="w-12 text-xs text-muted-foreground text-right shrink-0">Where</span>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setLogic(logic === FilterLogic.OR ? FilterLogic.AND : FilterLogic.OR)
                }
                className="w-12 text-xs font-medium text-primary text-right shrink-0 hover:underline"
              >
                {logic === FilterLogic.OR ? "OR" : "AND"}
              </button>
            )}

            {row.node.kind === "group" ? (
              <span className="flex-1 text-xs text-muted-foreground">
                A group of {row.node.group.nodes.length} conditions
              </span>
            ) : (
              <ConditionRow
                projectId={projectId}
                condition={row.node.condition}
                fieldChoices={fieldChoices}
                fieldsById={fieldsById}
                onFieldChange={(key) => {
                  const ref = fieldRefFromKey(key);
                  const condition = ref ? conditionFor(ref) : null;
                  if (condition) updateCondition(row.id, condition);
                }}
                onChange={(condition) => updateCondition(row.id, condition)}
              />
            )}

            <button
              type="button"
              onClick={() => setRows(rows.filter((other) => other.id !== row.id))}
              className="p-1 rounded hover:bg-muted transition-colors shrink-0"
              title="Remove condition"
            >
              <X size={12} className="text-muted-foreground" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between p-3 border-t border-border/60">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={addCondition}>
          <Plus size={12} className="mr-1" />
          Add condition
        </Button>

        <div className="flex items-center gap-2">
          {filter && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={handleClear}
            >
              Clear all
            </Button>
          )}
          <Button size="sm" className="h-7 text-xs" onClick={handleApply}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ConditionRowProps {
  projectId: string;
  condition: ViewFilterCondition;
  fieldChoices: Choice[];
  fieldsById: ReadonlyMap<string, FieldDefinition>;
  onFieldChange: (key: string) => void;
  onChange: (condition: ViewFilterCondition) => void;
}

function ConditionRow({
  projectId,
  condition,
  fieldChoices,
  fieldsById,
  onFieldChange,
  onChange,
}: ConditionRowProps) {
  const kind = fieldKindOf(condition.field, fieldsById);
  const operators = kind ? operatorsFor(kind, condition.field) : [];
  const key = fieldRefKey(condition.field);
  const choices = fieldChoices.some((choice) => choice.value === key)
    ? fieldChoices
    : [...fieldChoices, { value: key, label: fieldRefLabel(condition.field, fieldsById) }];

  const changeOperator = (operator: Op) => {
    if (!kind) return;
    const keepsValue =
      !EMPTINESS_OPERATORS.has(operator) &&
      !EMPTINESS_OPERATORS.has(condition.operator) &&
      (operator === Op.BETWEEN) === (condition.operator === Op.BETWEEN);
    onChange({
      ...condition,
      operator,
      value: keepsValue ? condition.value : blankValue(kind, operator),
    });
  };

  return (
    <>
      <ChoiceSelect value={key} choices={choices} onChange={onFieldChange} minWidth={110} />
      <ChoiceSelect
        value={String(condition.operator)}
        choices={operators.map((operator) => ({
          value: String(operator),
          label: OPERATOR_LABELS.get(operator) ?? "",
        }))}
        onChange={(value) => changeOperator(Number(value) as Op)}
        minWidth={100}
      />
      {kind && !EMPTINESS_OPERATORS.has(condition.operator) && (
        <ConditionValueInput
          projectId={projectId}
          kind={kind}
          condition={condition}
          fieldsById={fieldsById}
          onChange={(value) => onChange({ ...condition, value })}
        />
      )}
      {(!kind || EMPTINESS_OPERATORS.has(condition.operator)) && <span className="flex-1" />}
    </>
  );
}

interface ChoiceSelectProps {
  value: string | string[];
  choices: Choice[];
  onChange: (value: string) => void;
  placeholder?: string;
  minWidth?: number;
}

/** A compact dropdown; with an array value each pick toggles one choice and the menu stays open. */
function ChoiceSelect({ value, choices, onChange, placeholder, minWidth = 80 }: ChoiceSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const multiple = Array.isArray(value);
  const picked = multiple ? value : [value];
  const selected = choices.filter((choice) => picked.includes(choice.value));
  const label =
    selected.length === 0
      ? (placeholder ?? "Select...")
      : selected.length === 1
        ? selected[0].label
        : `${selected[0].label} +${selected.length - 1}`;

  const handleClose = useCallback(() => setIsOpen(false), []);

  const handleToggle = useCallback(() => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 160) });
    }
    setIsOpen((prev) => !prev);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, handleClose]);

  return (
    <div className="flex-1" style={{ minWidth }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={cn(
          controlShellClass,
          "focus-ring flex items-center justify-between gap-1 w-full h-7 px-2 text-xs",
          isOpen && "border-border-strong",
          selected.length > 0 ? "text-foreground" : "text-subtle-foreground",
        )}
      >
        <span className="truncate flex-1 text-left">
          {selected.length === 1 && selected[0].color && (
            <span
              className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
              style={{ backgroundColor: selected[0].color }}
            />
          )}
          {label}
        </span>
        <CaretDown
          size={10}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          data-select-portal
          className={cn(
            popoverShellClass,
            "fixed z-[100] py-1 max-h-56 overflow-y-auto animate-in fade-in-0 zoom-in-95",
          )}
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          {choices.length === 0 && (
            <div className="px-2.5 py-1.5 text-xs text-muted-foreground">Nothing to pick</div>
          )}
          {choices.map((choice) => {
            const isActive = picked.includes(choice.value);
            return (
              <button
                key={choice.value}
                type="button"
                onClick={() => {
                  onChange(choice.value);
                  if (!multiple) setIsOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-xs transition-colors",
                  isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                )}
              >
                {choice.color && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: choice.color }}
                  />
                )}
                <span className="flex-1 text-left truncate">{choice.label}</span>
                {isActive && <Check size={12} weight="bold" className="shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const VALUE_INPUT_CLASS = "h-7 px-2 text-xs flex-1 min-w-[80px]";

interface ConditionValueInputProps {
  projectId: string;
  kind: FieldKind;
  condition: ViewFilterCondition;
  fieldsById: ReadonlyMap<string, FieldDefinition>;
  onChange: (value: ViewFilterValue | null) => void;
}

function ConditionValueInput({
  projectId,
  kind,
  condition,
  fieldsById,
  onChange,
}: ConditionValueInputProps) {
  const { operator, value } = condition;

  if (ID_KINDS.has(kind)) {
    return (
      <IdValueInput
        projectId={projectId}
        kind={kind}
        condition={condition}
        fieldsById={fieldsById}
        set={value?.kind === "ids" ? value.ids : NO_ID_SET}
        onChange={(ids) => onChange({ kind: "ids", ids })}
      />
    );
  }

  if (kind === "boolean") {
    return (
      <ChoiceSelect
        value={value?.kind === "flag" && !value.flag ? "no" : "yes"}
        choices={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        onChange={(choice) => onChange({ kind: "flag", flag: choice === "yes" })}
      />
    );
  }

  if (kind === "number") {
    if (operator === Op.BETWEEN) {
      const range = value?.kind === "numberRange" ? value : { min: NaN, max: NaN };
      const update = (min: number, max: number) => onChange({ kind: "numberRange", min, max });
      return (
        <div className="flex items-center gap-1 flex-1 min-w-40">
          <NumberInput
            value={Number.isFinite(range.min) ? String(range.min) : ""}
            onChange={(e) => update(e.target.value ? Number(e.target.value) : NaN, range.max)}
            placeholder="Min"
            className={VALUE_INPUT_CLASS}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <NumberInput
            value={Number.isFinite(range.max) ? String(range.max) : ""}
            onChange={(e) => update(range.min, e.target.value ? Number(e.target.value) : NaN)}
            placeholder="Max"
            className={VALUE_INPUT_CLASS}
          />
        </div>
      );
    }
    return (
      <NumberInput
        value={
          value?.kind === "number" && Number.isFinite(value.number) ? String(value.number) : ""
        }
        onChange={(e) =>
          onChange(e.target.value ? { kind: "number", number: Number(e.target.value) } : null)
        }
        placeholder="Value..."
        className={VALUE_INPUT_CLASS}
      />
    );
  }

  if (kind === "date" || kind === "timestamp") {
    if (operator === Op.BETWEEN) {
      const start: ViewFilterDate =
        value?.kind === "dateRange" ? value.start : { kind: "fixed", date: "" };
      const end: ViewFilterDate =
        value?.kind === "dateRange" ? value.end : { kind: "fixed", date: "" };
      return (
        <div className="flex items-center gap-1 flex-1 min-w-60 flex-wrap">
          <DateValueInput
            date={start}
            onChange={(next) => onChange({ kind: "dateRange", start: next, end })}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <DateValueInput
            date={end}
            onChange={(next) => onChange({ kind: "dateRange", start, end: next })}
          />
        </div>
      );
    }
    return (
      <DateValueInput
        date={value?.kind === "date" ? value.date : { kind: "fixed", date: "" }}
        onChange={(date) => onChange({ kind: "date", date })}
      />
    );
  }

  return (
    <Input
      type="text"
      value={value?.kind === "text" ? value.text : ""}
      onChange={(e) => onChange(e.target.value ? { kind: "text", text: e.target.value } : null)}
      placeholder="Value..."
      className={VALUE_INPUT_CLASS}
    />
  );
}

function DateValueInput({
  date,
  onChange,
}: {
  date: ViewFilterDate;
  onChange: (date: ViewFilterDate) => void;
}) {
  const mode = date.kind === "fixed" ? "fixed" : String(date.anchor);
  return (
    <div className="flex items-center gap-1 flex-1 min-w-40">
      <ChoiceSelect
        value={mode}
        choices={DATE_MODES}
        onChange={(next) =>
          onChange(
            next === "fixed"
              ? { kind: "fixed", date: "" }
              : { kind: "relative", anchor: Number(next) as RelativeDateAnchor, offsetDays: 0 },
          )
        }
        minWidth={100}
      />
      {date.kind === "fixed" ? (
        <Input
          type="date"
          value={date.date}
          onChange={(e) => onChange({ kind: "fixed", date: e.target.value })}
          className={VALUE_INPUT_CLASS}
        />
      ) : (
        <NumberInput
          value={date.offsetDays === 0 ? "" : String(date.offsetDays)}
          onChange={(e) =>
            onChange({
              ...date,
              offsetDays: e.target.value ? Math.trunc(Number(e.target.value)) : 0,
            })
          }
          placeholder="± days"
          title="Days after (or, negative, before) the anchor"
          className="h-7 px-2 text-xs w-20"
        />
      )}
    </div>
  );
}

interface IdValueInputProps {
  projectId: string;
  kind: FieldKind;
  condition: ViewFilterCondition;
  fieldsById: ReadonlyMap<string, FieldDefinition>;
  set: ViewFilterIdSet;
  onChange: (set: ViewFilterIdSet) => void;
}

function IdValueInput({
  projectId,
  kind,
  condition,
  fieldsById,
  set,
  onChange,
}: IdValueInputProps) {
  const selectProjectTasks = useMemo(() => selectTasksForProject(projectId), [projectId]);
  const tasks = useAppSelector(selectProjectTasks);
  const sprints = useAppSelector(selectSprintsForProject(projectId));
  const single = SINGLE_ID_OPERATORS.has(condition.operator);
  const flags = ID_FLAGS[kind] ?? [];

  if (kind === "tags") {
    return (
      <div className="flex-1 min-w-[160px]">
        <TagPicker
          selectedTagIds={set.ids}
          onChange={(ids) => onChange({ ...set, ids })}
          placeholder="Pick tags"
        />
      </div>
    );
  }

  if (kind === "person" || kind === "single_person") {
    const me = set.includeCurrentUser;
    return (
      <div className="flex items-center gap-1 flex-1 min-w-[180px]">
        <PersonFilterInput
          ids={set.ids}
          single={single}
          onChange={(ids) =>
            onChange({ ...set, ids, includeCurrentUser: single && ids.length > 0 ? false : me })
          }
        />
        {flags.includes("includeCurrentUser") && (
          <button
            type="button"
            onClick={() =>
              onChange({ ...set, ids: single && !me ? [] : set.ids, includeCurrentUser: !me })
            }
            className={cn(
              "h-7 px-2 rounded-md text-xs shrink-0 transition-colors",
              me ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
            title="Whoever is viewing"
          >
            Me
          </button>
        )}
      </div>
    );
  }

  let choices: Choice[] = [];
  if (kind === "single_select" || kind === "multi_select") {
    const field =
      condition.field.kind === "field" ? fieldsById.get(condition.field.fieldId) : undefined;
    choices = (field?.config.options ?? []).map((option) => ({
      value: option.id,
      label: option.label,
      color: option.color,
    }));
  } else if (kind === "task_type") {
    choices = TASK_TYPES.map((type) => ({ value: type.value, label: type.label }));
  } else if (kind === "sprint") {
    choices = [
      { value: ACTIVE_SPRINT_CHOICE, label: "Active sprint" },
      ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name })),
    ];
  } else if (kind === "epic") {
    choices = tasks
      .filter((task) => task.taskType === "epic")
      .map((task) => ({ value: task.id, label: task.title }));
  } else {
    choices = tasks.map((task) => ({ value: task.id, label: task.title }));
  }

  const picked = [...set.ids, ...(set.includeActiveSprint ? [ACTIVE_SPRINT_CHOICE] : [])];

  const pick = (choice: string) => {
    const has = picked.includes(choice);
    const base = single ? NO_ID_SET : set;
    if (choice === ACTIVE_SPRINT_CHOICE) {
      onChange({ ...base, includeActiveSprint: single ? true : !set.includeActiveSprint });
      return;
    }
    if (single) {
      onChange({ ...NO_ID_SET, ids: [choice] });
      return;
    }
    onChange({
      ...set,
      ids: has ? set.ids.filter((id) => id !== choice) : [...set.ids, choice],
    });
  };

  return (
    <ChoiceSelect
      value={single ? (picked[0] ?? "") : picked}
      choices={choices}
      onChange={pick}
      placeholder="Select..."
      minWidth={140}
    />
  );
}
