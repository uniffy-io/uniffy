import { useEffect, useCallback } from "react";
import { TaskDetailPanel } from "@/features/projects/components/detail/TaskDetailPanel";

interface TaskDetailModalProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDetailModal({ taskId, onClose }: TaskDetailModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-card w-[calc(100vw-2rem)] max-w-6xl rounded-t-xl sm:rounded-xl shadow-2xl border border-border overflow-hidden h-[90vh] flex flex-col min-h-0">
        <TaskDetailPanel taskId={taskId} variant="modal" />
      </div>
    </div>
  );
}
