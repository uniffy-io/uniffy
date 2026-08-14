import { useState, useCallback } from "react";
import { StackSimple, Check } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { updateProject } from "@/features/projects/store/projectsThunks";
import { TASK_TYPES, getTaskTypeConfig } from "@/features/projects/utils/taskTypes";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Project, TypeFieldSchema } from "@/features/projects/types";

const SYSTEM_IDS: Set<string> = new Set(Object.values(SYSTEM_FIELD_IDS));

interface TaskTypesSectionProps {
  project: Project;
}

export function TaskTypesSection({ project }: TaskTypesSectionProps) {
  const dispatch = useAppDispatch();
  const customFields = project.fieldDefinitions.filter((f) => !f.isSystem && !SYSTEM_IDS.has(f.id));
  const [schemas, setSchemas] = useState<Record<string, TypeFieldSchema>>(
    project.typeFieldSchemas || {},
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const persistSchemas = useCallback(
    async (newSchemas: Record<string, TypeFieldSchema>) => {
      setSaving(true);
      try {
        await dispatch(updateProject({ id: project.id, typeFieldSchemas: newSchemas })).unwrap();
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } finally {
        setSaving(false);
      }
    },
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
    [dispatch, project.id],
  );

  const toggleShown = useCallback(
    (taskType: string, fieldId: string) => {
      const schema = schemas[taskType] || { shownFieldIds: [], requiredFieldIds: [] };
      const shownSet = new Set(schema.shownFieldIds);
      const requiredSet = new Set(schema.requiredFieldIds);

      if (shownSet.has(fieldId)) {
        shownSet.delete(fieldId);
        requiredSet.delete(fieldId);
      } else {
        shownSet.add(fieldId);
      }

      const newSchemas = {
        ...schemas,
        [taskType]: {
          shownFieldIds: [...shownSet],
          requiredFieldIds: [...requiredSet],
        },
      };
      setSchemas(newSchemas);
      persistSchemas(newSchemas);
    },
    [schemas, persistSchemas],
  );

  const toggleRequired = useCallback(
    (taskType: string, fieldId: string) => {
      const schema = schemas[taskType] || { shownFieldIds: [], requiredFieldIds: [] };
      const shownSet = new Set(schema.shownFieldIds);
      const requiredSet = new Set(schema.requiredFieldIds);

      if (requiredSet.has(fieldId)) {
        requiredSet.delete(fieldId);
      } else {
        requiredSet.add(fieldId);
        shownSet.add(fieldId);
      }

      const newSchemas = {
        ...schemas,
        [taskType]: {
          shownFieldIds: [...shownSet],
          requiredFieldIds: [...requiredSet],
        },
      };
      setSchemas(newSchemas);
      persistSchemas(newSchemas);
    },
    [schemas, persistSchemas],
  );

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
          <StackSimple size={24} weight="duotone" className="text-primary shrink-0" />
          Task Types
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <Check size={14} weight="bold" />
              Saved
            </span>
          )}
        </h1>
        <p className="text-muted-foreground">
          Configure which custom fields are shown and required for each task type.
        </p>
      </div>

      {customFields.length === 0 ? (
        <div className="bg-card rounded-lg border border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No custom fields defined yet. Create custom fields first to configure type-specific
            field visibility.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {TASK_TYPES.map((taskType) => {
            const config = getTaskTypeConfig(taskType.value);
            const TypeIcon = config.icon;
            const schema = schemas[taskType.value] || {
              shownFieldIds: [],
              requiredFieldIds: [],
            };
            const shownSet = new Set(schema.shownFieldIds);
            const requiredSet = new Set(schema.requiredFieldIds);

            return (
              <section key={taskType.value} className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <TypeIcon size={18} weight="fill" className="text-muted-foreground" />
                  {config.label}
                  <span className="text-xs font-normal text-muted-foreground ml-auto">
                    {shownSet.size} of {customFields.length} shown
                  </span>
                </h2>
                <div className="bg-card rounded-lg border border-border">
                  <div className="divide-y divide-border">
                    {customFields.map((field) => (
                      <div
                        key={field.id}
                        className="flex items-center justify-between gap-4 px-4 py-3"
                      >
                        <span className="text-sm text-foreground truncate flex-1">
                          {field.name}
                        </span>
                        <div className="flex items-center gap-6 shrink-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Show</span>
                            <ToggleSwitch
                              enabled={shownSet.has(field.id)}
                              onChange={() => toggleShown(taskType.value, field.id)}
                              disabled={saving}
                              size="sm"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "text-xs",
                                shownSet.has(field.id)
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground/40",
                              )}
                            >
                              Required
                            </span>
                            <ToggleSwitch
                              enabled={requiredSet.has(field.id)}
                              onChange={() => toggleRequired(taskType.value, field.id)}
                              disabled={saving || !shownSet.has(field.id)}
                              size="sm"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
