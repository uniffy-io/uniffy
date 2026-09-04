import { useCallback } from "react";
import { cn } from "@/shared/utils/cn";
import { Checkbox } from "@/components/ui/checkbox";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
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
      const schema = typeFieldSchemas[taskType] || {
        shownFieldIds: [],
        requiredFieldIds: [],
      };
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
    [typeFieldSchemas, onChange],
  );

  const toggleRequired = useCallback(
    (taskType: string, fieldId: string) => {
      const schema = typeFieldSchemas[taskType] || {
        shownFieldIds: [],
        requiredFieldIds: [],
      };
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
    [typeFieldSchemas, onChange],
  );

  if (customFields.length === 0) {
    return (
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          Type Field Schemas
        </label>
        <p className="text-xs text-muted-foreground">
          Add custom fields to the project first, then configure which fields are shown and required
          per task type.
        </p>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">Type Field Schemas</label>
      <p className="text-xs text-muted-foreground mb-3">
        Configure which custom fields are shown and required for each task type.
      </p>

      <div className="space-y-3">
        {TASK_TYPES.map((taskType) => {
          const config = getTaskTypeConfig(taskType.value);
          const schema = typeFieldSchemas[taskType.value] || {
            shownFieldIds: [],
            requiredFieldIds: [],
          };
          const shownSet = new Set(schema.shownFieldIds);
          const requiredSet = new Set(schema.requiredFieldIds);

          return (
            <div key={taskType.value} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 mb-2">
                <TaskTypeIcon type={taskType.value} className="text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{config.label}</span>
              </div>

              {customFields.map((field) => (
                <div key={field.id} className="flex items-center justify-between py-1.5 px-1">
                  <span className="text-sm text-foreground truncate flex-1 mr-2">{field.name}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        size="sm"
                        id={`${taskType.value}-${field.id}-shown`}
                        checked={shownSet.has(field.id)}
                        onChange={() => toggleShown(taskType.value, field.id)}
                      />
                      <label
                        htmlFor={`${taskType.value}-${field.id}-shown`}
                        className="text-xs text-muted-foreground cursor-pointer select-none"
                      >
                        Show
                      </label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        size="sm"
                        id={`${taskType.value}-${field.id}-required`}
                        checked={requiredSet.has(field.id)}
                        onChange={() => toggleRequired(taskType.value, field.id)}
                      />
                      <label
                        htmlFor={`${taskType.value}-${field.id}-required`}
                        className={cn(
                          "text-xs cursor-pointer select-none",
                          shownSet.has(field.id)
                            ? "text-muted-foreground"
                            : "text-subtle-foreground",
                        )}
                      >
                        Required
                      </label>
                    </div>
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
