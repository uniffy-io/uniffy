import { useState } from "react";
import { ArrowsClockwise, Calendar, FastForward } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { cn } from "@/shared/utils/cn";
import type { RecurrenceEditScope } from "@/features/calendar/types";

interface RecurrenceEditScopeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (scope: RecurrenceEditScope) => void;
  action: "edit" | "delete";
}

interface ScopeOption {
  value: RecurrenceEditScope;
  icon: React.ElementType;
  label: string;
  description: string;
}

function getScopeOptions(action: "edit" | "delete"): ScopeOption[] {
  const isDelete = action === "delete";
  return [
    {
      value: "this_event",
      icon: Calendar,
      label: "This event",
      description: isDelete ? "Only cancel this occurrence" : "Only modify this occurrence",
    },
    {
      value: "all_events",
      icon: ArrowsClockwise,
      label: "All events",
      description: isDelete ? "Delete the entire series" : "Modify the entire series",
    },
    {
      value: "this_and_following",
      icon: FastForward,
      label: "This and following events",
      description: isDelete
        ? "Cancel from this occurrence onwards"
        : "Modify from this occurrence onwards",
    },
  ];
}

export function RecurrenceEditScopeDialog({
  isOpen,
  onClose,
  onSelect,
  action,
}: RecurrenceEditScopeDialogProps) {
  const [selected, setSelected] = useState<RecurrenceEditScope>("this_event");
  const [prevOpen, setPrevOpen] = useState(false);

  // Render-phase reset avoids an effect-loop.
  if (isOpen && !prevOpen) {
    setPrevOpen(true);
    setSelected("this_event");
  } else if (!isOpen && prevOpen) {
    setPrevOpen(false);
  }

  if (!isOpen) return null;

  const isDelete = action === "delete";
  const options = getScopeOptions(action);

  const handleConfirm = () => {
    onSelect(selected);
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <ModalHeader title={isDelete ? "Delete recurring event" : "Edit recurring event"} />

      <ModalBody className="space-y-2">
        {options.map((option) => {
          const isSelected = selected === option.value;
          const Icon = option.icon;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setSelected(option.value)}
              className={cn(
                "w-full flex items-start gap-3 p-3 rounded-lg text-left cursor-pointer",
                "border transition-all duration-150",
                isSelected
                  ? "border-primary bg-primary/8 ring-1 ring-primary/30"
                  : "border-border bg-card hover:bg-muted",
              )}
            >
              <div
                className={cn(
                  "mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2 transition-colors",
                  isSelected
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/40 bg-transparent",
                )}
              >
                {isSelected && (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                  </div>
                )}
              </div>

              <Icon
                className={cn(
                  "mt-0.5 flex-shrink-0 w-4 h-4",
                  isSelected ? "text-primary" : "text-muted-foreground",
                )}
                weight={isSelected ? "fill" : "regular"}
              />

              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{option.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{option.description}</p>
              </div>
            </button>
          );
        })}
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={isDelete ? "destructive" : "default"}
          onClick={handleConfirm}
        >
          {isDelete ? "Delete" : "Confirm"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
