/**
 * TaskDetailModal - Centered modal wrapper for TaskDetailPanel.
 *
 * Renders the same TaskDetailPanel content in a centered overlay instead
 * of the right sidebar. Used when the user prefers modal view mode.
 */

import { useEffect, useCallback } from "react";
import { TaskDetailPanel } from "@/features/projects/components/detail/TaskDetailPanel";

interface TaskDetailModalProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDetailModal({ taskId, onClose }: TaskDetailModalProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card w-[calc(100vw-2rem)] max-w-5xl rounded-t-xl sm:rounded-xl shadow-2xl border border-border overflow-hidden max-h-[85vh] flex flex-col">
        <TaskDetailPanel taskId={taskId} variant="modal" />
      </div>
    </div>
  );
}
