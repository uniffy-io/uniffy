import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { TaskRecurrenceSelector } from "@/features/projects/components/detail/TaskRecurrenceSelector";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input, controlShellClass } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { NumberInput } from "@/components/ui/number-input";
import { DatePicker } from "@/components/ui/date-picker";
import { ExpandableEditor } from "@/components/editor/ExpandableEditor";
import { attachmentsApi } from "@/features/files/api/attachmentsApi";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { Select } from "@/components/ui/select";
import { cn } from "@/shared/utils/cn";
import { SubjectPicker } from "@/components/subject";
import { selectCurrentProject } from "../../store/projectsSlice";
import { closeCreateTaskModal } from "../../store/projectsUiSlice";
import { createTask } from "../../store/projectsThunks";
import { SYSTEM_FIELD_IDS } from "../../types";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { TASK_TYPES, getFieldsForTaskType } from "@/features/projects/utils/taskTypes";
import type { FieldDefinition, FieldValue, SelectOption } from "@/features/projects/types";
import { MultiSelectField } from "@/features/projects/utils/multiSelectUtils";
import { parseMultiSelectValue } from "@/features/projects/utils/multiSelectParsers";
import { TagPicker } from "@/features/tags";

export function CreateTaskModal() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // Null until the user picks one; the project's field options supply the default until then.
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const [priorityOverride, setPriorityOverride] = useState<string | null>(null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, FieldValue>>({});
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [taskType, setTaskType] = useState("task");
  const [isAssigneeDropdownOpen, setIsAssigneeDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);
  const pendingFileIdsRef = useRef<string[]>([]);

  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const handleFileUploaded = useCallback((fileId: string) => {
    pendingFileIdsRef.current.push(fileId);
  }, []);

  const statusField = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
  const priorityField = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.PRIORITY);
  const statusOptions = useMemo(
    () => statusField?.config.options || [],
    [statusField?.config.options],
  );
  const priorityOptions = useMemo(
    () => priorityField?.config.options || [],
    [priorityField?.config.options],
  );

  const status = statusOverride ?? statusOptions[0]?.id ?? "";
  const priority =
    priorityOverride ??
    priorityOptions.find((o) => o.id.includes("medium"))?.id ??
    priorityOptions[0]?.id ??
    "";

  const handleClose = useCallback(() => {
    setTitle("");
    setDescription("");
    setAssigneeIds([]);
    setStartDate("");
    setDueDate("");
    setTaskType("task");
    setTagIds([]);
    pendingFileIdsRef.current = [];
    dispatch(closeCreateTaskModal());
  }, [dispatch]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const typeCustomFields = useMemo((): {
    fields: FieldDefinition[];
    requiredIds: Set<string>;
  } => {
    if (!project) return { fields: [], requiredIds: new Set() };
    const { visibleFieldIds, requiredFieldIds } = getFieldsForTaskType(
      project.fieldDefinitions,
      taskType,
      project.typeFieldSchemas || {},
    );
    const fields = project.fieldDefinitions.filter((f) => !f.isSystem && visibleFieldIds.has(f.id));
    return { fields, requiredIds: requiredFieldIds };
  }, [project, taskType]);

  const handleFieldValueChange = useCallback((fieldId: string, value: FieldValue) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !project) return;

    const submittableFieldValues: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(fieldValues)) {
      if (v !== null && v !== "" && v !== undefined) {
        submittableFieldValues[k] = v;
      }
    }

    setIsSubmitting(true);
    try {
      const result = await dispatch(
        createTask({
          projectId: project.id,
          title: title.trim(),
          description: description.trim(),
          status,
          priority,
          assigneeIds,
          startDate: startDate || null,
          dueDate: dueDate || null,
          taskType,
          recurrenceRule: recurrenceRule || null,
          fieldValues:
            Object.keys(submittableFieldValues).length > 0 ? submittableFieldValues : undefined,
          tagIds: tagIds.length ? tagIds : undefined,
        }),
      ).unwrap();

      // Files uploaded while the task had no id yet are linked once it exists.
      if (pendingFileIdsRef.current.length > 0 && organizationId && result.task.id) {
        await Promise.all(
          pendingFileIdsRef.current.map((fileId) =>
            attachmentsApi
              .attachFile({
                organizationId,
                sourceFileId: fileId,
                contentType: ContentType.TASK,
                contentId: result.task.id,
              })
              .catch((err) => {
                console.error("[CreateTaskModal] Failed to attach file:", err);
              }),
          ),
        );
        pendingFileIdsRef.current = [];
      }

      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal onClose={handleClose} closeDisabled={isSubmitting} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit}>
        <ModalHeader title="New task" />

        <ModalBody>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Type</label>
            <div className="flex gap-2 flex-wrap">
              {TASK_TYPES.map((type) => {
                const isActive = taskType === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setTaskType(type.value)}
                    disabled={isSubmitting}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors",
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    <TaskTypeIcon type={type.value} />
                    {type.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Title</label>
            <Input
              ref={inputRef}
              type="text"
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              Description (optional)
            </label>
            <ExpandableEditor
              contentType={ContentType.TASK}
              contentId=""
              value={description}
              onChange={setDescription}
              placeholder="Add more details... (type @ to mention)"
              label="Description"
              readonly={isSubmitting}
              enableUpload
              onFileUploaded={handleFileUploaded}
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm text-muted-foreground mb-1">Status</label>
              <Select
                value={status}
                onChange={setStatusOverride}
                disabled={isSubmitting}
                options={statusOptions.map((opt) => ({
                  value: opt.id,
                  label: opt.label,
                }))}
                placeholder="Select status..."
                className="w-full"
              />
            </div>

            <div className="flex-1">
              <label className="block text-sm text-muted-foreground mb-1">Priority</label>
              <Select
                value={priority}
                onChange={setPriorityOverride}
                disabled={isSubmitting}
                options={priorityOptions.map((opt) => ({
                  value: opt.id,
                  label: opt.label,
                }))}
                placeholder="Select priority..."
                className="w-full"
              />
            </div>
          </div>

          <div className="relative" ref={assigneeDropdownRef}>
            <label className="block text-sm text-muted-foreground mb-1">Assignees</label>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setIsAssigneeDropdownOpen((prev) => !prev);
              }}
              className={cn(
                controlShellClass,
                "focus-ring flex items-center gap-2 w-full h-10 px-3 py-2 text-sm",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "text-subtle-foreground",
                isAssigneeDropdownOpen && "border-border-strong",
              )}
            >
              <span className="flex-1 text-left truncate">Select assignees...</span>
              <CaretDown size={14} className="text-muted-foreground shrink-0" />
            </button>

            {isAssigneeDropdownOpen && (
              <SubjectPicker
                mode="multi"
                subjectTypes="all"
                value={assigneeIds}
                onChange={(ids) => setAssigneeIds(ids)}
                onClose={() => setIsAssigneeDropdownOpen(false)}
                autoFocus
              />
            )}
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm text-muted-foreground mb-1">Start date</label>
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                placeholder="Pick start date"
                disabled={isSubmitting}
              />
            </div>

            <div className="flex-1">
              <label className="block text-sm text-muted-foreground mb-1">Due date</label>
              <DatePicker
                value={dueDate}
                onChange={setDueDate}
                placeholder="Pick due date"
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Tags (optional)</label>
            <TagPicker
              selectedTagIds={tagIds}
              onChange={setTagIds}
              disabled={isSubmitting}
              placeholder="Add a tag"
            />
          </div>

          <TaskRecurrenceSelector
            value={recurrenceRule}
            onChange={setRecurrenceRule}
            disabled={isSubmitting}
          />

          {typeCustomFields.fields.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-border">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Custom Fields
              </span>
              {typeCustomFields.fields.map((field) => {
                const isRequired = typeCustomFields.requiredIds.has(field.id);
                return (
                  <div key={field.id}>
                    <label className="block text-sm text-muted-foreground mb-1">
                      {field.name}
                      {isRequired && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    {field.type === "single_select" ? (
                      <Select
                        value={(fieldValues[field.id] as string) ?? ""}
                        onChange={(v) => handleFieldValueChange(field.id, v || null)}
                        disabled={isSubmitting}
                        options={
                          (field.config.options as SelectOption[] | undefined)?.map((opt) => ({
                            value: opt.id,
                            label: opt.label,
                          })) ?? []
                        }
                        placeholder={`Select ${field.name.toLowerCase()}...`}
                        className="w-full"
                      />
                    ) : field.type === "multi_select" ? (
                      <MultiSelectField
                        options={field.config.options || []}
                        value={parseMultiSelectValue(fieldValues[field.id])}
                        onChange={(ids) =>
                          handleFieldValueChange(field.id, ids.length > 0 ? ids : null)
                        }
                        disabled={isSubmitting}
                        placeholder={`Select ${field.name.toLowerCase()}...`}
                      />
                    ) : field.type === "number" ? (
                      <NumberInput
                        value={(fieldValues[field.id] as string) ?? ""}
                        onChange={(e) =>
                          handleFieldValueChange(
                            field.id,
                            e.target.value ? Number(e.target.value) : null,
                          )
                        }
                        disabled={isSubmitting}
                      />
                    ) : field.type === "date" ? (
                      <DatePicker
                        value={(fieldValues[field.id] as string) ?? ""}
                        onChange={(v) => handleFieldValueChange(field.id, v || null)}
                        disabled={isSubmitting}
                      />
                    ) : (
                      <Input
                        type="text"
                        placeholder={field.name}
                        value={(fieldValues[field.id] as string) ?? ""}
                        onChange={(e) => handleFieldValueChange(field.id, e.target.value || null)}
                        disabled={isSubmitting}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!title.trim() || isSubmitting}>
            {isSubmitting ? "Creating..." : "Create task"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
