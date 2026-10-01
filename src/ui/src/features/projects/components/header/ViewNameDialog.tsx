import { useState } from "react";
import { LockSimple, UsersThree } from "@phosphor-icons/react";
import { ViewVisibility } from "@uniffy/proto/projects/v1/projects_pb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { OptionTile } from "@/components/ui/option-tile";

interface ViewNameDialogProps {
  title: string;
  description?: string;
  initialName: string;
  submitLabel: string;
  /** Offers the personal or shared choice; leave out to ask for a name only. */
  visibility?: { initial: ViewVisibility; canShare: boolean };
  onSubmit: (name: string, visibility: ViewVisibility) => Promise<boolean> | boolean;
  onClose: () => void;
}

const MAX_VIEW_NAME_LENGTH = 100;

export function ViewNameDialog({
  title,
  description,
  initialName,
  submitLabel,
  visibility,
  onSubmit,
  onClose,
}: ViewNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [chosen, setChosen] = useState(visibility?.initial ?? ViewVisibility.PERSONAL);
  const [isSaving, setIsSaving] = useState(false);
  const trimmed = name.trim();

  const submit = async () => {
    if (!trimmed || isSaving) return;
    setIsSaving(true);
    try {
      if (await onSubmit(trimmed, chosen)) onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-md" closeDisabled={isSaving}>
      <ModalHeader title={title} description={description} />
      <ModalBody>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-5"
        >
          <div>
            <label htmlFor="view-name" className="block text-sm text-muted-foreground mb-1">
              Name
            </label>
            <Input
              id="view-name"
              autoFocus
              value={name}
              maxLength={MAX_VIEW_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {visibility && (
            <div role="radiogroup" aria-label="Who sees this view" className="grid gap-2">
              <OptionTile
                selected={chosen === ViewVisibility.PERSONAL}
                icon={<LockSimple size={16} />}
                label="Personal"
                description="Only you see this view."
                onSelect={() => setChosen(ViewVisibility.PERSONAL)}
              />
              {visibility.canShare && (
                <OptionTile
                  selected={chosen === ViewVisibility.SHARED}
                  icon={<UsersThree size={16} />}
                  label="Shared"
                  description="Everyone on this project sees this view."
                  onSelect={() => setChosen(ViewVisibility.SHARED)}
                />
              )}
            </div>
          )}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!trimmed} loading={isSaving}>
          {submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
