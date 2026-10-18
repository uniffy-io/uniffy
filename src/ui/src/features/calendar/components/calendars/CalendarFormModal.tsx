import { useId, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { CATEGORY_COLORS } from "@/features/calendar/constants";
import { createCalendar, updateCalendarThunk } from "@/features/calendar/store";
import type { CalendarInfo } from "@/features/calendar/types";
import { cn } from "@/shared/utils/cn";

interface CalendarFormModalProps {
  /** The calendar being edited; omitted to create one. */
  calendar?: CalendarInfo;
  onClose: () => void;
}

export function CalendarFormModal({ calendar, onClose }: CalendarFormModalProps) {
  const dispatch = useAppDispatch();
  const policy = useAppSelector((state) => state.calendar.calendarPolicy);
  const isEditing = !!calendar;
  const [name, setName] = useState(calendar?.name ?? "");
  const [description, setDescription] = useState(calendar?.description ?? "");
  const [color, setColor] = useState(calendar?.color ?? CATEGORY_COLORS[0].value);
  const [submitting, setSubmitting] = useState(false);

  const fieldId = useId();
  const canSubmit =
    name.trim().length > 0 && !submitting && (isEditing || policy?.canCreateTeamCalendars === true);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    const outcome = calendar
      ? await dispatch(
          updateCalendarThunk({
            calendarId: calendar.id,
            name: name.trim(),
            description,
            color,
          }),
        )
      : await dispatch(
          createCalendar({
            name: name.trim(),
            description,
            color,
            kind: "personal",
          }),
        );
    setSubmitting(false);
    if (outcome.meta.requestStatus === "fulfilled") onClose();
  };

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-md">
      <form onSubmit={handleSubmit}>
        <ModalHeader
          title={isEditing ? "Edit calendar" : "New calendar"}
          description={
            isEditing ? undefined : "Share it afterwards from the calendar's menu in the sidebar."
          }
        />

        <ModalBody>
          <div>
            <label htmlFor={`${fieldId}-name`} className="block text-sm text-muted-foreground mb-1">
              Name
            </label>
            <Input
              id={`${fieldId}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Support rota"
              maxLength={200}
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor={`${fieldId}-description`}
              className="block text-sm text-muted-foreground mb-1"
            >
              Description <span className="text-subtle-foreground">(optional)</span>
            </label>
            <Textarea
              id={`${fieldId}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Color</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setColor(option.value)}
                  className={cn(
                    "focus-ring w-11 h-11 rounded-full transition-transform hover:scale-105",
                    color.toLowerCase() === option.value.toLowerCase() &&
                      "outline outline-2 outline-offset-2 outline-primary",
                  )}
                  style={{ backgroundColor: option.value }}
                  title={option.name}
                  aria-label={option.name}
                  aria-pressed={color.toLowerCase() === option.value.toLowerCase()}
                />
              ))}
            </div>
          </div>

          {!isEditing && policy && !policy.canCreateTeamCalendars && (
            <p className="text-sm text-muted-foreground">
              Your organization limits new calendars to calendar admins.
            </p>
          )}
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting} disabled={!canSubmit}>
            {isEditing ? "Save changes" : "Create calendar"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
