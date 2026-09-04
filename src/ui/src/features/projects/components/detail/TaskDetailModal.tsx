import { Modal } from "@/components/ui/modal";
import { TaskDetailPanel } from "@/features/projects/components/detail/TaskDetailPanel";

interface TaskDetailModalProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDetailModal({ taskId, onClose }: TaskDetailModalProps) {
  return (
    <Modal
      onClose={onClose}
      maxWidth="max-w-6xl"
      className="flex flex-col h-[90dvh]"
      ariaLabel="Task details"
    >
      <TaskDetailPanel taskId={taskId} variant="modal" />
    </Modal>
  );
}
