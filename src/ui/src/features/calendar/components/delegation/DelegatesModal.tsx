import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatar, SUBJECT_TYPE } from "@/components/subject";
import { SubjectPicker } from "@/components/subject/SubjectPicker";
import type { Subject } from "@/components/subject/types";
import { Button } from "@/components/ui/button";
import { controlShellClass } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { cn } from "@/shared/utils/cn";
import {
  fetchCalendarPolicy,
  fetchMyDelegations,
  grantDelegation,
  revokeDelegation,
} from "@/features/calendar/store";
import type { CalendarDelegationInfo, CalendarDelegationLevel } from "@/features/calendar/types";
import { DELEGATION_LEVEL_OPTIONS } from "@/features/calendar/utils/delegation";

const LEVEL_SELECT_OPTIONS = DELEGATION_LEVEL_OPTIONS.map(({ value, label }) => ({ value, label }));

interface DelegatesModalProps {
  onClose: () => void;
}

/** The grantor names colleagues who may run their personal calendars for them. */
export function DelegatesModal({ onClose }: DelegatesModalProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? "");
  const delegates = useAppSelector((state) => state.calendar.delegationsByMe);
  const policy = useAppSelector((state) => state.calendar.calendarPolicy);
  const canDelegate = policy?.canDelegate ?? true;

  const [picked, setPicked] = useState<Subject | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [level, setLevel] = useState<CalendarDelegationLevel>("events");
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<CalendarDelegationInfo | null>(null);
  const [removing, setRemoving] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);

  // The policy may have changed since the calendar page loaded it.
  useEffect(() => {
    void dispatch(fetchMyDelegations());
    void dispatch(fetchCalendarPolicy());
  }, [dispatch]);

  const add = async () => {
    if (!picked || saving) return;
    setSaving(true);
    const outcome = await dispatch(grantDelegation({ delegateId: picked.id, level }));
    setSaving(false);
    if (grantDelegation.fulfilled.match(outcome)) {
      toast.success(`${outcome.payload.delegateName} can now manage your calendar`);
      setPicked(null);
      setLevel("events");
    }
  };

  const changeLevel = async (delegation: CalendarDelegationInfo, next: CalendarDelegationLevel) => {
    if (next === delegation.level || changingId) return;
    setChangingId(delegation.id);
    await dispatch(grantDelegation({ delegateId: delegation.delegateId, level: next }));
    setChangingId(null);
  };

  const remove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    const outcome = await dispatch(revokeDelegation(removeTarget.id));
    setRemoving(false);
    if (revokeDelegation.fulfilled.match(outcome)) {
      toast.success(`${removeTarget.delegateName} no longer manages your calendar`);
    }
    setRemoveTarget(null);
  };

  const levelDescription = DELEGATION_LEVEL_OPTIONS.find((o) => o.value === level)?.description;

  return (
    <Modal onClose={onClose} closeDisabled={saving} maxWidth="max-w-lg">
      <ModalHeader
        title="Calendar delegates"
        description="Delegates book, edit and cancel meetings and answer invitations for you. You stay the organizer; they are shown as the arranger."
      />
      <ModalBody>
        <div className="space-y-5">
          {canDelegate ? (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="delegate-picker-trigger"
                  className="block text-sm text-muted-foreground mb-1"
                >
                  Add a delegate
                </label>
                {pickerOpen ? (
                  <SubjectPicker
                    mode="single"
                    subjectTypes="users"
                    value={picked ? [picked.id] : []}
                    onChange={(_ids, subjects) => {
                      setPicked(subjects[0] ?? null);
                      setPickerOpen(false);
                    }}
                    onClose={() => setPickerOpen(false)}
                    excludeIds={[currentUserId, ...delegates.map((d) => d.delegateId)]}
                    placeholder="Search people..."
                    autoFocus
                  />
                ) : (
                  <button
                    id="delegate-picker-trigger"
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className={cn(
                      controlShellClass,
                      "focus-ring flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    )}
                  >
                    {picked ? (
                      <>
                        <SubjectAvatar subject={picked} size="xs" />
                        <span className="text-foreground">{picked.name}</span>
                      </>
                    ) : (
                      <span className="text-subtle-foreground">Choose a colleague...</span>
                    )}
                  </button>
                )}
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">What they can do</label>
                <Select
                  value={level}
                  onChange={setLevel}
                  options={LEVEL_SELECT_OPTIONS}
                  triggerClassName="w-full"
                  ariaLabel="Delegate level"
                />
                {levelDescription && (
                  <p className="mt-1 text-xs text-subtle-foreground">{levelDescription}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              Your organization lets only calendar admins add delegates.
            </p>
          )}

          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">
              Your delegates{delegates.length ? ` (${delegates.length})` : ""}
            </h3>
            {delegates.length === 0 ? (
              <p className="text-sm text-subtle-foreground">Nobody manages your calendar.</p>
            ) : (
              <ul className="divide-y divide-border/60 rounded-lg bg-card shadow-edge">
                {delegates.map((delegation) => (
                  <li
                    key={delegation.id}
                    className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap"
                  >
                    <SubjectAvatar
                      subject={{
                        id: delegation.delegateId,
                        name: delegation.delegateName,
                        type: SUBJECT_TYPE.USER,
                      }}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{delegation.delegateName}</p>
                      {delegation.inactive && (
                        <p className="text-xs text-subtle-foreground">
                          Deactivated - has no access for now
                        </p>
                      )}
                    </div>
                    <Select
                      value={delegation.level}
                      onChange={(next) => void changeLevel(delegation, next)}
                      options={LEVEL_SELECT_OPTIONS}
                      disabled={
                        // Under an admins-only policy a member may still lower a level.
                        (!canDelegate && delegation.level === "events") ||
                        changingId === delegation.id
                      }
                      size="sm"
                      triggerClassName="w-52"
                      ariaLabel={`${delegation.delegateName}'s level`}
                    />
                    <button
                      type="button"
                      onClick={() => setRemoveTarget(delegation)}
                      className="focus-ring rounded p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                      aria-label={`Remove ${delegation.delegateName}`}
                      title="Remove delegate"
                    >
                      <Trash size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Close
        </Button>
        {canDelegate && (
          <Button onClick={() => void add()} disabled={!picked} loading={saving}>
            Add delegate
          </Button>
        )}
      </ModalFooter>

      <ConfirmDialog
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => void remove()}
        title="Remove delegate?"
        message={`${removeTarget?.delegateName} will immediately lose access to your calendar.`}
        confirmLabel="Remove"
        variant="danger"
        loading={removing}
      />
    </Modal>
  );
}
