import { useState } from "react";
import { Funnel, Stack } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { OptionTile } from "@/components/ui/option-tile";
import { exportProjectTasks } from "@/features/projects/store/projectsThunks";
import type { ExportScope } from "@/features/projects/utils/exportTasks";

interface ExportTasksModalProps {
  projectIds: string[];
  onClose: () => void;
  allowCurrentView?: boolean;
  /** Why the current view cannot be exported, e.g. its filter names a deleted field. */
  viewBlockedReason?: string | null;
}

export function ExportTasksModal({
  projectIds,
  onClose,
  allowCurrentView = false,
  viewBlockedReason = null,
}: ExportTasksModalProps) {
  const dispatch = useAppDispatch();
  const single = projectIds.length === 1;
  const hasCurrentView = single && allowCurrentView;
  const [scope, setScope] = useState<ExportScope>(
    hasCurrentView && !viewBlockedReason ? "view" : "project",
  );
  const [includeBundle, setIncludeBundle] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const submit = async () => {
    setIsExporting(true);
    const result = await dispatch(
      exportProjectTasks({
        projectIds,
        scope: hasCurrentView && !viewBlockedReason ? scope : "project",
        includeBundle,
      }),
    );
    setIsExporting(false);
    if (exportProjectTasks.fulfilled.match(result)) onClose();
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-md" closeDisabled={isExporting}>
      <ModalHeader
        title="Export tasks"
        description={
          single
            ? "Download this project's tasks as a CSV file."
            : `Download every task of ${projectIds.length} projects as one CSV file.`
        }
      />
      <ModalBody>
        <div className="space-y-5">
          {hasCurrentView && (
            <div role="radiogroup" aria-label="What to export" className="grid gap-2">
              <OptionTile
                selected={scope === "view"}
                icon={<Funnel size={16} />}
                label="Current view"
                description={
                  viewBlockedReason ??
                  "This view's filter, sort and layout. Grouping and quick search are not applied."
                }
                disabled={Boolean(viewBlockedReason)}
                onSelect={() => setScope("view")}
              />
              <OptionTile
                selected={scope === "project"}
                icon={<Stack size={16} />}
                label="Whole project"
                description="Every task and subtask, in the project's own order."
                onSelect={() => setScope("project")}
              />
            </div>
          )}
          <Checkbox
            checked={includeBundle}
            onChange={(event) => setIncludeBundle(event.target.checked)}
            label="Include sprints, activity and comments"
            description="Downloads a zip with one CSV file for each."
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={isExporting}>
          Cancel
        </Button>
        <Button onClick={submit} loading={isExporting}>
          Export
        </Button>
      </ModalFooter>
    </Modal>
  );
}
