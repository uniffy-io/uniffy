import { Modal } from "@/components/ui/modal";
import { TaskDetailPanel } from "@/features/projects/components/detail/TaskDetailPanel";
import type { TaskOpenView } from "@/features/projects/utils/taskPath";

interface TaskDetailModalProps {
  taskId: string;
  onClose: () => void;
  view?: TaskOpenView;
}

export function TaskDetailModal({ taskId, onClose, view = "modal" }: TaskDetailModalProps) {
  return (
    <Modal
      onClose={onClose}
      maxWidth="max-w-6xl"
      className="flex flex-col h-[90dvh]"
      ariaLabel="Task details"
    >
      <TaskDetailPanel taskId={taskId} variant="modal" view={view} onClose={onClose} />
    </Modal>
  );
}
