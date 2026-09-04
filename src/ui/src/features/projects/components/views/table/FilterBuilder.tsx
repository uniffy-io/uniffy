import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, X, CaretDown, Check } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input, controlShellClass } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { popoverShellClass } from "@/components/ui/popover";
import { TagPicker } from "@/features/tags";
import type { FieldDefinition } from "@/features/projects/types";
import type {
  FilterCondition,
  FilterConfig,
  FilterOperator,
} from "@/features/projects/types/views";
import {
  HIERARCHY_DEPTH_FIELD_ID,
  HIERARCHY_HAS_SUBTASKS_FIELD_ID,
  HIERARCHY_IN_EPIC_FIELD_ID,
  HIERARCHY_ROOT_ONLY_FIELD_ID,
  TAGS_FILTER_FIELD_ID,
} from "@/features/projects/utils/filterTasks";

const TAGS_PSEUDO_FIELD: FieldDefinition = {
  id: TAGS_FILTER_FIELD_ID,
  projectId: "",
  name: "Tags",
  type: "text",
  isRequired: false,
  isSystem: true,
  sortOrder: 999,
  config: {},
  createdAt: "",
  updatedAt: "",
};

function _makePseudoField(
  id: string,
  name: string,
  type: FieldDefinition["type"],
): FieldDefinition {
  return {
    id,
    projectId: "",
    name,
    type,
    isRequired: false,
    isSystem: true,
    sortOrder: 1000,
    config: {},
    createdAt: "",
    updatedAt: "",
  };
}

const IN_EPIC_PSEUDO_FIELD = _makePseudoField(HIERARCHY_IN_EPIC_FIELD_ID, "In Epic", "text");
const ROOT_ONLY_PSEUDO_FIELD = _makePseudoField(HIERARCHY_ROOT_ONLY_FIELD_ID, "Root only", "text");
const HAS_SUBTASKS_PSEUDO_FIELD = _makePseudoField(
  HIERARCHY_HAS_SUBTASKS_FIELD_ID,
  "Has subtasks",
  "text",
);
const DEPTH_PSEUDO_FIELD = _makePseudoField(HIERARCHY_DEPTH_FIELD_ID, "Depth", "number");

const IN_EPIC_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "is_empty", label: "has no ancestors" },
  { value: "is_not_empty", label: "has ancestors" },
];

const ROOT_ONLY_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "is_empty", label: "yes (top-level)" },
  { value: "is_not_empty", label: "no (has parent)" },
];

const HAS_SUBTASKS_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "is_not_empty", label: "yes (has subtasks)" },
  { value: "is_empty", label: "no (leaf task)" },
];

const DEPTH_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
  { value: "between", label: "between" },
];

const TAG_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "contains", label: "is one of" },
  { value: "not_contains", label: "is none of" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

interface FilterBuilderProps {
  fields: FieldDefinition[];
  filterConfig: FilterConfig | null;
  onApply: (config: FilterConfig | null) => void;
  onClose: () => void;
  /** Optional Epic-task options for the "In Epic" pseudo-field. */
  epicOptions?: { value: string; label: string }[];
}

const TEXT_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const SELECT_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const DATE_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "greater_than", label: "is after" },
  { value: "less_than", label: "is before" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const NUMBER_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const PERSON_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

function getOperatorsForField(field: FieldDefinition): { value: FilterOperator; label: string }[] {
  if (field.id === TAGS_FILTER_FIELD_ID) return TAG_OPERATORS;
  if (field.id === HIERARCHY_IN_EPIC_FIELD_ID) return IN_EPIC_OPERATORS;
  if (field.id === HIERARCHY_ROOT_ONLY_FIELD_ID) return ROOT_ONLY_OPERATORS;
  if (field.id === HIERARCHY_HAS_SUBTASKS_FIELD_ID) return HAS_SUBTASKS_OPERATORS;
  if (field.id === HIERARCHY_DEPTH_FIELD_ID) return DEPTH_OPERATORS;
  switch (field.type) {
    case "single_select":
    case "multi_select":
      return SELECT_OPERATORS;
    case "date":
      return DATE_OPERATORS;
    case "number":
      return NUMBER_OPERATORS;
    case "person":
      return PERSON_OPERATORS;
    default:
      return TEXT_OPERATORS;
  }
}

function needsValueInput(operator: FilterOperator): boolean {
  return operator !== "is_empty" && operator !== "is_not_empty";
}

export function FilterBuilder({
  fields: rawFields,
  filterConfig,
  onApply,
  onClose,
  epicOptions,
}: FilterBuilderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The unified-tags filter and the hierarchy filters are exposed as
  // pseudo-fields so they slot into the existing condition row UI without
  // parallel infrastructure.
  const fields = [
    ...rawFields,
    TAGS_PSEUDO_FIELD,
    IN_EPIC_PSEUDO_FIELD,
    ROOT_ONLY_PSEUDO_FIELD,
    HAS_SUBTASKS_PSEUDO_FIELD,
    DEPTH_PSEUDO_FIELD,
  ];
  const [conditions, setConditions] = useState<FilterCondition[]>(filterConfig?.conditions ?? []);
  const [logic, setLogic] = useState<"and" | "or">(filterConfig?.logic ?? "and");

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const addCondition = () => {
    const firstField = fields[0];
    if (!firstField) return;
    const operators = getOperatorsForField(firstField);
    setConditions([
      ...conditions,
      {
        id: crypto.randomUUID(),
        fieldId: firstField.id,
        operator: operators[0].value,
        value: null,
      },
    ]);
  };

  const removeCondition = (id: string) => {
    setConditions(conditions.filter((c) => c.id !== id));
  };

  const updateCondition = (id: string, updates: Partial<FilterCondition>) => {
    setConditions(conditions.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const handleFieldChange = (conditionId: string, fieldId: string) => {
    const field = fields.find((f) => f.id === fieldId);
    const operators = field ? getOperatorsForField(field) : TEXT_OPERATORS;
    updateCondition(conditionId, {
      fieldId,
      operator: operators[0].value,
      value: null,
    });
  };

  const handleApply = () => {
    if (conditions.length === 0) {
      onApply(null);
    } else {
      onApply({ conditions, logic });
    }
    onClose();
  };

  const handleClear = () => {
    onApply(null);
    onClose();
  };

  return (
    <div
      ref={containerRef}
      className={cn(popoverShellClass, "absolute top-full right-0 z-50 mt-2 w-[520px]")}
    >
      <div className="p-3 border-b border-border">
        <span className="text-sm font-medium text-foreground">Filter tasks</span>
      </div>

      <div className="p-3 space-y-2 max-h-[320px] overflow-y-auto">
        {conditions.length === 0 && (
          <p className="text-sm text-muted-foreground py-2 text-center">
            No filters applied. Add a condition to filter tasks.
          </p>
        )}

        {conditions.map((condition, index) => {
          const field = fields.find((f) => f.id === condition.fieldId);
          const operators = field ? getOperatorsForField(field) : TEXT_OPERATORS;

          return (
            <div key={condition.id} className="flex items-center gap-2">
              {/* Logic label (AND/OR) */}
              {index === 0 ? (
                <span className="w-12 text-xs text-muted-foreground text-right shrink-0">
                  Where
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setLogic(logic === "and" ? "or" : "and")}
                  className="w-12 text-xs font-medium text-primary text-right shrink-0 hover:underline"
                >
                  {logic === "and" ? "AND" : "OR"}
                </button>
              )}

              {/* Field selector */}
              <FilterSelect
                value={condition.fieldId}
                options={fields.map((f) => ({ value: f.id, label: f.name }))}
                onChange={(val) => handleFieldChange(condition.id, val)}
                minWidth={100}
              />

              {/* Operator selector */}
              <FilterSelect
                value={condition.operator}
                options={operators.map((op) => ({
                  value: op.value,
                  label: op.label,
                }))}
                onChange={(val) =>
                  updateCondition(condition.id, {
                    operator: val as FilterOperator,
                    value: needsValueInput(val as FilterOperator) ? condition.value : null,
                  })
                }
                minWidth={100}
              />

              {/* Value input */}
              {needsValueInput(condition.operator) && (
                <ConditionValueInput
                  field={field}
                  operator={condition.operator}
                  value={condition.value}
                  onChange={(value) => updateCondition(condition.id, { value })}
                  epicOptions={epicOptions}
                />
              )}

              {/* Remove button */}
              <button
                type="button"
                onClick={() => removeCondition(condition.id)}
                className="p-1 rounded hover:bg-muted transition-colors shrink-0"
              >
                <X size={12} className="text-muted-foreground" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between p-3 border-t border-border">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={addCondition}>
          <Plus size={12} className="mr-1" />
          Add condition
        </Button>

        <div className="flex items-center gap-2">
          {filterConfig && (
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

interface FilterSelectProps {
  value: string;
  options: { value: string; label: string; color?: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  minWidth?: number;
}

function FilterSelect({ value, options, onChange, placeholder, minWidth = 80 }: FilterSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption?.label ?? placeholder ?? "Select...";

  const handleClose = useCallback(() => setIsOpen(false), []);

  const handleToggle = useCallback(() => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 140),
      });
    }
    setIsOpen((prev) => !prev);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, handleClose]);

  return (
    <div style={{ minWidth }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={cn(
          controlShellClass,
          "focus-ring flex items-center justify-between gap-1 w-full h-7 px-2 text-xs",
          isOpen && "border-border-strong",
          selectedOption ? "text-foreground" : "text-subtle-foreground",
        )}
      >
        <span className="truncate flex-1 text-left">
          {selectedOption?.color && (
            <span
              className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
              style={{ backgroundColor: selectedOption.color }}
            />
          )}
          {displayLabel}
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
          className={cn(
            popoverShellClass,
            "fixed z-[100] py-1 max-h-48 overflow-y-auto animate-in fade-in-0 zoom-in-95",
          )}
          style={{
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
          }}
        >
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-xs transition-colors",
                  isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                )}
              >
                {option.color && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: option.color }}
                  />
                )}
                <span className="flex-1 text-left truncate">{option.label}</span>
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

function ConditionValueInput({
  field,
  operator,
  value,
  onChange,
  epicOptions,
}: {
  field?: FieldDefinition;
  operator: FilterOperator;
  value: string | number | string[] | null;
  onChange: (value: string | number | string[] | null) => void;
  epicOptions?: { value: string; label: string }[];
}) {
  if (field?.id === TAGS_FILTER_FIELD_ID) {
    const selectedIds = Array.isArray(value) ? (value as string[]) : value ? [String(value)] : [];
    return (
      <div className="flex-1 min-w-[160px]">
        <TagPicker
          selectedTagIds={selectedIds}
          onChange={(next) => onChange(next.length ? next : null)}
          placeholder="Pick tags"
        />
      </div>
    );
  }

  if (field?.id === HIERARCHY_IN_EPIC_FIELD_ID) {
    const options = [
      {
        value: "",
        label: epicOptions && epicOptions.length ? "Pick an Epic..." : "No Epics in this project",
      },
      ...(epicOptions ?? []),
    ];
    return (
      <div className="flex-1 min-w-[160px]">
        <FilterSelect
          value={String(value ?? "")}
          options={options}
          onChange={(val) => onChange(val || null)}
          placeholder="Pick an Epic..."
        />
      </div>
    );
  }

  if (!field) {
    return (
      <Input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Value..."
        className={VALUE_INPUT_CLASS}
      />
    );
  }

  if (field.type === "single_select" || field.type === "multi_select") {
    return (
      <div className="flex-1 min-w-[80px]">
        <FilterSelect
          value={String(value ?? "")}
          options={[
            { value: "", label: "Select..." },
            ...(field.config.options ?? []).map((opt) => ({
              value: opt.id,
              label: opt.label,
              color: opt.color,
            })),
          ]}
          onChange={(val) => onChange(val || null)}
          placeholder="Select..."
        />
      </div>
    );
  }

  if (field.type === "date") {
    return (
      <Input
        type="date"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className={VALUE_INPUT_CLASS}
      />
    );
  }

  if (field.type === "number") {
    if (operator === "between") {
      const [minVal, maxVal] = Array.isArray(value)
        ? (value as [string | number, string | number])
        : [null, null];
      return (
        <div className="flex items-center gap-1 flex-1 min-w-40">
          <NumberInput
            inputMode="numeric"
            value={minVal !== null && minVal !== undefined ? String(minVal) : ""}
            onChange={(e) => {
              const next = e.target.value ? Number(e.target.value) : null;
              onChange(
                next !== null || maxVal !== null ? ([next, maxVal] as unknown as string[]) : null,
              );
            }}
            placeholder="Min"
            className={VALUE_INPUT_CLASS}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <NumberInput
            inputMode="numeric"
            value={maxVal !== null && maxVal !== undefined ? String(maxVal) : ""}
            onChange={(e) => {
              const next = e.target.value ? Number(e.target.value) : null;
              onChange(
                minVal !== null || next !== null ? ([minVal, next] as unknown as string[]) : null,
              );
            }}
            placeholder="Max"
            className={VALUE_INPUT_CLASS}
          />
        </div>
      );
    }
    return (
      <NumberInput
        inputMode="numeric"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        placeholder="Value..."
        className={VALUE_INPUT_CLASS}
      />
    );
  }

  return (
    <Input
      type="text"
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Value..."
      className={VALUE_INPUT_CLASS}
    />
  );
}
