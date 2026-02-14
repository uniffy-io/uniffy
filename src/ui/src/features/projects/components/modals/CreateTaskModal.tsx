/**
 * CreateTaskModal - Modal for creating a new task
 *
 * Form with title, description, status, priority, assignee, and dates.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { X, Plus, CaretDown, MagnifyingGlass, Check } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { MarkdownEditor } from "@/components/editor";
import { cn } from "@/shared/utils/cn";
import { selectCurrentProject } from "../../store/projectsSlice";
import { closeCreateTaskModal } from "../../store/projectsUiSlice";
import { createTask } from "../../store/projectsThunks";
import { SYSTEM_FIELD_IDS } from "../../types";
import { fetchMembers } from "@/features/admin";
import type { SerializedMemberInfo } from "@/features/admin";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [isAssigneeDropdownOpen, setIsAssigneeDropdownOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [editorReady, setEditorReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);
  const assigneeSearchRef = useRef<HTMLInputElement>(null);

  // Use org members from admin store
  const adminMembers = useAppSelector((state) => state.admin.members) as SerializedMemberInfo[];

  const activeMembers = useMemo(
    () => adminMembers.filter((m) => m.isActive),
    [adminMembers]
  );

  const filteredMembers = useMemo(() => {
    if (!assigneeSearch) return activeMembers;
    const q = assigneeSearch.toLowerCase();
    return activeMembers.filter(
      (m) => m.displayName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  }, [activeMembers, assigneeSearch]);

  // Get field options from project
  const statusField = project?.fieldDefinitions.find(
    (f) => f.id === SYSTEM_FIELD_IDS.STATUS
  );
  const priorityField = project?.fieldDefinitions.find(
    (f) => f.id === SYSTEM_FIELD_IDS.PRIORITY
  );
  const statusOptions = statusField?.config.options || [];
  const priorityOptions = priorityField?.config.options || [];

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

  // Load org members if not already loaded
  useEffect(() => {
    if (adminMembers.length === 0) {
      dispatch(fetchMembers({ pageSize: 50 }));
    }
  }, [dispatch, adminMembers.length]);

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Deferred editor mount (Milkdown needs the DOM ready)
  useEffect(() => {
    setEditorReady(false);
    const timer = setTimeout(() => {
      setEditorKey((prev) => prev + 1);
      setEditorReady(true);
    }, 50);
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
  }, [isSubmitting]);

  // Close assignee dropdown on outside click
  useEffect(() => {
    if (!isAssigneeDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(e.target as Node)) {
        setIsAssigneeDropdownOpen(false);
        setAssigneeSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAssigneeDropdownOpen]);

  const handleClose = () => {
    setTitle("");
    setDescription("");
    setAssigneeIds([]);
    setStartDate("");
    setDueDate("");
    dispatch(closeCreateTaskModal());
  };

  const toggleAssignee = (userId: string) => {
    setAssigneeIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !project) return;

    setIsSubmitting(true);
    try {
      await dispatch(
        createTask({
          projectId: project.id,
          title: title.trim(),
          description: description.trim(),
          status,
          priority,
          assigneeIds,
          startDate: startDate || null,
          dueDate: dueDate || null,
        })
      ).unwrap();
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
              {editorReady ? (
                <div className="border border-border rounded-lg overflow-hidden">
                  <MarkdownEditor
                    key={editorKey}
                    value={description}
                    onChange={setDescription}
                    placeholder="Add more details... (type @ to mention)"
                    minHeight="100px"
                    maxHeight="200px"
                    showBottomToolbar={true}
                    readonly={isSubmitting}
                  />
                </div>
              ) : (
                <div className="min-h-25 border border-border rounded-lg bg-muted/30 animate-pulse" />
              )}
            </div>

            {/* Status & Priority row */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {statusOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex-1">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {priorityOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
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
                  setAssigneeSearch("");
                  setTimeout(() => assigneeSearchRef.current?.focus(), 50);
                }}
                className={cn(
                  "flex items-center gap-2 w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm",
                  "transition-colors hover:bg-muted/50",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  assigneeIds.length > 0 ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <span className="flex-1 text-left truncate">
                  {assigneeIds.length === 0
                    ? "Select assignees..."
                    : assigneeIds.map((id) => {
                        const m = activeMembers.find((mem) => mem.userId === id);
                        return m?.displayName ?? id.slice(-6);
                      }).join(", ")}
                </span>
                <CaretDown size={14} className="text-muted-foreground shrink-0" />
              </button>

              {/* Dropdown popover */}
              {isAssigneeDropdownOpen && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-border bg-card shadow-lg">
                  {/* Search */}
                  <div className="p-2 border-b border-border">
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-background">
                      <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
                      <input
                        ref={assigneeSearchRef}
                        type="text"
                        value={assigneeSearch}
                        onChange={(e) => setAssigneeSearch(e.target.value)}
                        placeholder="Search members..."
                        className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>

                  {/* Member list */}
                  <div className="max-h-48 overflow-y-auto py-1">
                    {filteredMembers.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {activeMembers.length === 0 ? "No members available" : "No members found"}
                      </div>
                    ) : (
                      filteredMembers.map((member) => {
                        const isSelected = assigneeIds.includes(member.userId);
                        const parts = member.displayName.split(" ").filter(Boolean);
                        const initials = parts.length >= 2
                          ? (parts[0][0] + parts[1][0]).toUpperCase()
                          : member.displayName.slice(0, 2).toUpperCase();
                        return (
                          <button
                            key={member.userId}
                            type="button"
                            onClick={() => toggleAssignee(member.userId)}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors",
                              isSelected ? "bg-primary/10" : "hover:bg-muted"
                            )}
                          >
                            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground shrink-0">
                              {initials}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-foreground truncate block">{member.displayName}</span>
                              <span className="text-xs text-muted-foreground truncate block">{member.email}</span>
                            </div>
                            {isSelected && (
                              <Check size={14} className="text-primary shrink-0" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* Footer */}
                  {assigneeIds.length > 0 && (
                    <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
                      {assigneeIds.length} selected
                    </div>
                  )}
                </div>
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
