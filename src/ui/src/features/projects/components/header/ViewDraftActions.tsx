import { useState } from "react";
import { ArrowCounterClockwise, CopySimple, FloppyDisk } from "@phosphor-icons/react";
import { ViewVisibility } from "@uniffy/proto/projects/v1/projects_pb";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import type { ViewConfig } from "@/features/projects/types";
import { dropViewDraft } from "@/features/projects/store/projectsUiSlice";
import { saveViewAs, saveViewDraft } from "@/features/projects/store/viewActions";
import { ViewNameDialog } from "@/features/projects/components/header/ViewNameDialog";

interface ViewDraftActionsProps {
  projectId: string;
  view: ViewConfig;
  canSave: boolean;
  canShare: boolean;
  compact: boolean;
}

export function ViewDraftActions({
  projectId,
  view,
  canSave,
  canShare,
  compact,
}: ViewDraftActionsProps) {
  const dispatch = useAppDispatch();
  const [isSaving, setIsSaving] = useState(false);
  const [isSaveAsOpen, setIsSaveAsOpen] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await dispatch(saveViewDraft(projectId, view.id));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      role="group"
      aria-label="Unsaved view changes"
    >
      {canSave && (
        <Button
          size="sm"
          className="h-11 min-w-11 lg:h-7 lg:min-w-0 gap-1 px-2 text-xs"
          onClick={handleSave}
          loading={isSaving}
          title="Save changes to this view"
        >
          <FloppyDisk size={14} />
          {!compact && "Save"}
        </Button>
      )}
      <Button
        size="sm"
        variant={canSave ? "ghost" : "default"}
        className="h-11 min-w-11 lg:h-7 lg:min-w-0 gap-1 px-2 text-xs"
        onClick={() => setIsSaveAsOpen(true)}
        title="Save as a new view"
      >
        <CopySimple size={14} />
        {!compact && "Save as new"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-11 min-w-11 lg:h-7 lg:min-w-0 gap-1 px-2 text-xs text-muted-foreground"
        onClick={() => dispatch(dropViewDraft({ projectId, viewId: view.id }))}
        title="Discard changes"
      >
        <ArrowCounterClockwise size={14} />
        {!compact && "Discard"}
      </Button>

      {isSaveAsOpen && (
        <ViewNameDialog
          title="Save as new view"
          description="Your changes go into the new view; this one stays as it was saved."
          initialName={`${view.name} copy`}
          submitLabel="Save view"
          visibility={{ initial: ViewVisibility.PERSONAL, canShare }}
          onSubmit={async (name, visibility) =>
            (await dispatch(saveViewAs(projectId, view, name, visibility))) !== null
          }
          onClose={() => setIsSaveAsOpen(false)}
        />
      )}
    </div>
  );
}
