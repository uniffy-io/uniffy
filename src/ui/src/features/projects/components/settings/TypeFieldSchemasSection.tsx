/**
 * TypeFieldSchemasSection - Configure which fields are shown/required per task type
 *
 * Used in the EditProjectModal to let admins define per-type field schemas.
 * Only custom (non-system) fields are configurable. System fields are always shown.
 */

import { useCallback } from "react";
import { cn } from "@/shared/utils/cn";
import { TASK_TYPES, getTaskTypeConfig } from "@/features/projects/utils/taskTypes";
import type { FieldDefinition } from "@/features/projects/types/fields";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { TypeFieldSchema } from "@/features/projects/types/project";

const SYSTEM_IDS: Set<string> = new Set(Object.values(SYSTEM_FIELD_IDS));

interface TypeFieldSchemasSectionProps {
  fieldDefinitions: FieldDefinition[];
  typeFieldSchemas: Record<string, TypeFieldSchema>;
  onChange: (schemas: Record<string, TypeFieldSchema>) => void;
}

export function TypeFieldSchemasSection({
  fieldDefinitions,
  typeFieldSchemas,
  onChange,
}: TypeFieldSchemasSectionProps) {
  const customFields = fieldDefinitions.filter((f) => !f.isSystem && !SYSTEM_IDS.has(f.id));

  const toggleShown = useCallback(
    (taskType: string, fieldId: string) => {
      const schema = typeFieldSchemas[taskType] || { shownFieldIds: [], requiredFieldIds: [] };
      const shownSet = new Set(schema.shownFieldIds);
      const requiredSet = new Set(schema.requiredFieldIds);

      if (shownSet.has(fieldId)) {
        shownSet.delete(fieldId);
        requiredSet.delete(fieldId); // Can't require a hidden field
      } else {
        shownSet.add(fieldId);
      }

      onChange({
        ...typeFieldSchemas,
        [taskType]: {
          shownFieldIds: [...shownSet],
          requiredFieldIds: [...requiredSet],
        },
      });
    },
    [typeFieldSchemas, onChange]
  );

  const toggleRequired = useCallback(
    (taskType: string, fieldId: string) => {
      const schema = typeFieldSchemas[taskType] || { shownFieldIds: [], requiredFieldIds: [] };
      const shownSet = new Set(schema.shownFieldIds);
      const requiredSet = new Set(schema.requiredFieldIds);

      if (requiredSet.has(fieldId)) {
        requiredSet.delete(fieldId);
      } else {
        requiredSet.add(fieldId);
        shownSet.add(fieldId); // Required implies shown
      }

      onChange({
        ...typeFieldSchemas,
        [taskType]: {
          shownFieldIds: [...shownSet],
          requiredFieldIds: [...requiredSet],
        },
      });
    },
    [typeFieldSchemas, onChange]
  );

  if (customFields.length === 0) {
    return (
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          Type Field Schemas
        </label>
        <p className="text-xs text-muted-foreground">
          Add custom fields to the project first, then configure which fields are shown and required per task type.
        </p>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        Type Field Schemas
      </label>
      <p className="text-xs text-muted-foreground mb-3">
        Configure which custom fields are shown and required for each task type.
      </p>

      <div className="space-y-3">
        {TASK_TYPES.map((taskType) => {
          const config = getTaskTypeConfig(taskType.value);
          const TypeIcon = config.icon;
          const schema = typeFieldSchemas[taskType.value] || { shownFieldIds: [], requiredFieldIds: [] };
          const shownSet = new Set(schema.shownFieldIds);
          const requiredSet = new Set(schema.requiredFieldIds);

          return (
            <div key={taskType.value} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 mb-2">
                <TypeIcon size={14} weight="fill" className="text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{config.label}</span>
              </div>

              {customFields.map((field) => (
                <div
                  key={field.id}
                  className="flex items-center justify-between py-1.5 px-1"
                >
                  <span className="text-sm text-foreground truncate flex-1 mr-2">
                    {field.name}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={shownSet.has(field.id)}
                        onChange={() => toggleShown(taskType.value, field.id)}
                        className="h-3.5 w-3.5 rounded border-border"
                      />
                      Show
                    </label>
                    <label className={cn(
                      "flex items-center gap-1.5 text-xs cursor-pointer",
                      shownSet.has(field.id) ? "text-muted-foreground" : "text-muted-foreground/40"
                    )}>
                      <input
                        type="checkbox"
                        checked={requiredSet.has(field.id)}
                        onChange={() => toggleRequired(taskType.value, field.id)}
                        className="h-3.5 w-3.5 rounded border-border"
                      />
                      Required
                    </label>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
