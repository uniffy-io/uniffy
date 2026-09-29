import { useId, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SubjectChip } from "@/components/subject/SubjectChip";
import { SubjectPicker } from "@/components/subject/SubjectPicker";
import { SUBJECT_TYPE, type Subject } from "@/components/subject/types";
import { CATEGORY_COLORS } from "@/features/calendar/constants";
import { createCalendar, updateCalendarThunk } from "@/features/calendar/store";
import type { CalendarInfo } from "@/features/calendar/types";
import { cn } from "@/shared/utils/cn";

type FormKind = "personal" | "team";

interface CalendarFormModalProps {
  /** The calendar being edited; omitted to create one. */
  calendar?: CalendarInfo;
  onClose: () => void;
}

export function CalendarFormModal({ calendar, onClose }: CalendarFormModalProps) {
  const dispatch = useAppDispatch();
  const policy = useAppSelector((state) => state.calendar.calendarPolicy);
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? "");
  const isEditing = !!calendar;
  // Until the policy loads, offer team calendars; the server has the last word.
  const canCreateTeam = policy?.canCreateTeamCalendars ?? true;

  const [name, setName] = useState(calendar?.name ?? "");
  const [description, setDescription] = useState(calendar?.description ?? "");
  const [color, setColor] = useState(calendar?.color ?? CATEGORY_COLORS[0].value);
  const [kind, setKind] = useState<FormKind>("personal");
  const [coAdmins, setCoAdmins] = useState<Subject[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fieldId = useId();
  // A policy that loads after "Team" was picked withdraws the choice with it.
  const isTeam = !isEditing && kind === "team" && canCreateTeam;
  // A team calendar outlives any one person, so it starts with a second admin.
  const missingCoAdmin = isTeam && coAdmins.length === 0;
  const canSubmit = name.trim().length > 0 && !missingCoAdmin && !submitting;

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
            kind: isTeam ? "team" : "personal",
            adminUserIds: coAdmins.filter((s) => s.type === SUBJECT_TYPE.USER).map((s) => s.id),
            adminGroupIds: coAdmins.filter((s) => s.type === SUBJECT_TYPE.GROUP).map((s) => s.id),
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
          {!isEditing && canCreateTeam && (
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Type</label>
              <SegmentedControl
                value={kind}
                onChange={setKind}
                options={[
                  { value: "personal", content: "Personal" },
                  { value: "team", content: "Team" },
                ]}
                ariaLabel="Calendar type"
                className="w-fit"
              />
            </div>
          )}

          <div>
            <label htmlFor={`${fieldId}-name`} className="block text-sm text-muted-foreground mb-1">
              Name
            </label>
            <Input
              id={`${fieldId}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isTeam ? "e.g. Support rota" : "e.g. Side projects"}
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
                    "focus-ring w-8 h-8 rounded-full transition-transform hover:scale-110",
                    color.toLowerCase() === option.value.toLowerCase() &&
                      "ring-2 ring-offset-2 ring-primary ring-offset-background scale-110",
                  )}
                  style={{ backgroundColor: option.value }}
                  title={option.name}
                  aria-label={option.name}
                  aria-pressed={color.toLowerCase() === option.value.toLowerCase()}
                />
              ))}
            </div>
          </div>

          {isTeam && (
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Co-admins</label>
              {pickerOpen ? (
                <SubjectPicker
                  mode="single"
                  subjectTypes="all"
                  value={coAdmins.map((s) => s.id)}
                  onChange={(_ids, subjects) => {
                    const picked = subjects[0];
                    if (picked && !coAdmins.some((s) => s.id === picked.id)) {
                      setCoAdmins((prev) => [...prev, picked]);
                    }
                    setPickerOpen(false);
                  }}
                  onClose={() => setPickerOpen(false)}
                  excludeIds={currentUserId ? [currentUserId] : []}
                  placeholder="Add people or groups..."
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="focus-ring w-full rounded-md border border-border bg-input px-3 py-1.5 text-left text-sm text-subtle-foreground hover:border-border-strong transition-colors"
                >
                  Add people or groups...
                </button>
              )}
              {coAdmins.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {coAdmins.map((subject) => (
                    <SubjectChip
                      key={subject.id}
                      subject={subject}
                      onRemove={() =>
                        setCoAdmins((prev) => prev.filter((s) => s.id !== subject.id))
                      }
                    />
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-subtle-foreground">
                Co-admins can manage the calendar and its events, so the team keeps it if you leave.
              </p>
            </div>
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
