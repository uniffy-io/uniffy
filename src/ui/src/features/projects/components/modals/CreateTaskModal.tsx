/**
 * CreateTaskModal - Modal for creating a new task
 *
 * Form with title, description, status, priority, assignee, and dates.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { X, Plus, CaretDown } from "@phosphor-icons/react";
import { TaskRecurrenceSelector } from "@/features/projects/components/detail/TaskRecurrenceSelector";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { ExpandableEditor } from "@/components/editor/ExpandableEditor";
import { attachmentsApi } from "@/features/attachments";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { Select } from "@/components/ui/select";
import { cn } from "@/shared/utils/cn";
import { SubjectPicker } from "@/components/subject";
import { selectCurrentProject } from "../../store/projectsSlice";
import { closeCreateTaskModal } from "../../store/projectsUiSlice";
import { createTask } from "../../store/projectsThunks";
import { SYSTEM_FIELD_IDS } from "../../types";
import { TASK_TYPES, getFieldsForTaskType } from "@/features/projects/utils/taskTypes";
import type { FieldDefinition, FieldValue, SelectOption } from "@/features/projects/types";
import { MultiSelectField } from "@/features/projects/utils/multiSelectUtils";
import { parseMultiSelectValue } from "@/features/projects/utils/multiSelectParsers";

export function CreateTaskModal() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, FieldValue>>({});
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

  // Get field options from project
  const statusField = project?.fieldDefinitions.find(
    (f) => f.id === SYSTEM_FIELD_IDS.STATUS
  );
  const priorityField = project?.fieldDefinitions.find(
    (f) => f.id === SYSTEM_FIELD_IDS.PRIORITY
  );
  const statusOptions = useMemo(
    () => statusField?.config.options || [],
    [statusField?.config.options]
  );
  const priorityOptions = useMemo(
    () => priorityField?.config.options || [],
    [priorityField?.config.options]
  );

  // Set defaults
  useEffect(() => {
    if (statusOptions.length > 0 && !status) {
      setStatus(statusOptions[0].id);
    }
    if (priorityOptions.length > 0 && !priority) {
      const medium = priorityOptions.find((o) => o.id.includes("medium"));
      setPriority(medium?.id || priorityOptions[0].id);
    }
  }, [statusOptions, priorityOptions, status, priority]);

  const handleClose = useCallback(() => {
    setTitle("");
    setDescription("");
    setAssigneeIds([]);
    setStartDate("");
    setDueDate("");
    setTaskType("task");
    pendingFileIdsRef.current = [];
    dispatch(closeCreateTaskModal());
  }, [dispatch]);

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Close on escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSubmitting) {
        handleClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, handleClose]);

  // Compute visible custom fields for the selected task type
  const typeCustomFields = useMemo((): { fields: FieldDefinition[]; requiredIds: Set<string> } => {
    if (!project) return { fields: [], requiredIds: new Set() };
    const { visibleFieldIds, requiredFieldIds } = getFieldsForTaskType(
      project.fieldDefinitions,
      taskType,
      project.typeFieldSchemas || {},
    );
    const fields = project.fieldDefinitions.filter(
      (f) => !f.isSystem && visibleFieldIds.has(f.id)
    );
    return { fields, requiredIds: requiredFieldIds };
  }, [project, taskType]);

  const handleFieldValueChange = useCallback((fieldId: string, value: FieldValue) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !project) return;

    // Build field values to send (only non-empty)
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
          fieldValues: Object.keys(submittableFieldValues).length > 0 ? submittableFieldValues : undefined,
        })
      ).unwrap();

      // Attach any files that were uploaded during creation (deferred mode)
      if (pendingFileIdsRef.current.length > 0 && organizationId && result.task.id) {
        await Promise.all(
          pendingFileIdsRef.current.map((fileId) =>
            attachmentsApi.attachFile({
              organizationId,
              sourceFileId: fileId,
              contentType: ContentType.TASK,
              contentId: result.task.id,
            }).catch((err) => {
              console.error('[CreateTaskModal] Failed to attach file:', err);
            })
          )
        );
        pendingFileIdsRef.current = [];
      }

      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-100 flex items-start justify-center pt-[5vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !isSubmitting && handleClose()}
      />

      {/* Dialog */}
      <div className="relative bg-card w-full max-w-lg mx-4 rounded-xl shadow-2xl border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Plus size={20} weight="bold" className="text-primary" />
            <h3 className="text-lg font-semibold text-foreground">New Task</h3>
          </div>
          <button
            type="button"
            onClick={() => !isSubmitting && handleClose()}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Issue Type */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Type
              </label>
              <div className="flex gap-2 flex-wrap">
                {TASK_TYPES.map((type) => {
                  const TypeIcon = type.icon;
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
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <TypeIcon
                        size={14}
                        weight={isActive ? "fill" : "regular"}
                      />
                      {type.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Title
              </label>
              <Input
                ref={inputRef}
                type="text"
                placeholder="What needs to be done?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Description
                <span className="text-muted-foreground font-normal ml-1">
                  (optional)
                </span>
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

            {/* Status & Priority row */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Status
                </label>
                <Select
                  value={status}
                  onChange={setStatus}
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
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Priority
                </label>
                <Select
                  value={priority}
                  onChange={setPriority}
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

            {/* Assignees */}
            <div className="relative" ref={assigneeDropdownRef}>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Assignees
              </label>

              {/* Dropdown trigger */}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setIsAssigneeDropdownOpen((prev) => !prev);
                }}
                className={cn(
                  "flex items-center gap-2 w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm",
                  "transition-colors hover:bg-muted/50",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  "text-muted-foreground"
                )}
              >
                <span className="flex-1 text-left truncate">Select assignees...</span>
                <CaretDown size={14} className="text-muted-foreground shrink-0" />
              </button>

              {/* Dropdown popover */}
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

            {/* Dates row */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Start Date
                </label>
                <DatePicker
                  value={startDate}
                  onChange={setStartDate}
                  placeholder="Pick start date"
                  disabled={isSubmitting}
                />
              </div>

              <div className="flex-1">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Due Date
                </label>
                <DatePicker
                  value={dueDate}
                  onChange={setDueDate}
                  placeholder="Pick due date"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Recurrence */}
            <TaskRecurrenceSelector
              value={recurrenceRule}
              onChange={setRecurrenceRule}
              disabled={isSubmitting}
            />

            {/* Type-specific custom fields */}
            {typeCustomFields.fields.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Custom Fields
                </span>
                {typeCustomFields.fields.map((field) => {
                  const isRequired = typeCustomFields.requiredIds.has(field.id);
                  return (
                    <div key={field.id}>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        {field.name}
                        {isRequired && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      {field.type === "single_select" ? (
                        <Select
                          value={(fieldValues[field.id] as string) ?? ""}
                          onChange={(v) => handleFieldValueChange(field.id, v || null)}
                          disabled={isSubmitting}
                          options={(field.config.options as SelectOption[] | undefined)?.map((opt) => ({
                            value: opt.id,
                            label: opt.label,
                          })) ?? []}
                          placeholder={`Select ${field.name.toLowerCase()}...`}
                          className="w-full"
                        />
                      ) : field.type === "multi_select" ? (
                        <MultiSelectField
                          options={field.config.options || []}
                          value={parseMultiSelectValue(fieldValues[field.id])}
                          onChange={(ids) => handleFieldValueChange(field.id, ids.length > 0 ? ids : null)}
                          disabled={isSubmitting}
                          placeholder={`Select ${field.name.toLowerCase()}...`}
                        />
                      ) : field.type === "number" ? (
                        <Input
                          type="number"
                          value={(fieldValues[field.id] as string) ?? ""}
                          onChange={(e) => handleFieldValueChange(field.id, e.target.value ? Number(e.target.value) : null)}
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
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 bg-muted/30 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Task"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
