import { useCallback, useEffect, useState } from "react";
import { CalendarBlank } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { fetchCalendarPolicy, updateCalendarPolicy } from "@/features/calendar/store";
import type { CalendarPolicyAudience } from "@/features/calendar/types";

const AUDIENCE_OPTIONS: SelectOption<CalendarPolicyAudience>[] = [
  { value: "everyone", label: "Every member" },
  { value: "admins", label: "Org and calendar admins" },
];

interface PolicyForm {
  teamCalendarCreators: CalendarPolicyAudience;
  orgWideCalendarSharers: CalendarPolicyAudience;
}

export function CalendarPolicySection() {
  useDocumentTitle("Calendar");
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const role = useAppSelector((state) => state.auth.currentOrganizationRole);
  const policy = useAppSelector((state) => state.calendar.calendarPolicy);
  const isAdmin = role === "OWNER" || role === "ADMIN";

  // Edits live here until saved; the stored policy seeds them.
  const [draft, setDraft] = useState<PolicyForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const form: PolicyForm | null =
    draft ??
    (policy
      ? {
          teamCalendarCreators: policy.teamCalendarCreators,
          orgWideCalendarSharers: policy.orgWideCalendarSharers,
        }
      : null);

  const load = useCallback(
    () =>
      dispatch(fetchCalendarPolicy()).then((outcome) =>
        setLoadFailed(fetchCalendarPolicy.rejected.match(outcome)),
      ),
    [dispatch],
  );

  useEffect(() => {
    if (organizationId) void load();
  }, [load, organizationId]);

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    const outcome = await dispatch(updateCalendarPolicy(form));
    setSaving(false);
    if (updateCalendarPolicy.fulfilled.match(outcome)) {
      setDraft(null);
      toast.success("Calendar policy saved");
    }
  };

  const disabled = !isAdmin || saving;

  return (
    <div className="space-y-6 w-full mx-auto max-w-3xl">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <CalendarBlank size={24} weight="duotone" className="text-primary shrink-0" />
          <h1 className="text-xl md:text-2xl font-bold">Calendar</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Who may set up calendars for a team, and who may open a calendar to the whole
          organization. Calendar admins are granted on the Domain Admins page. These rules decide
          who can make the change; they never give anyone access to a calendar.
        </p>
      </div>

      {!form ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface shadow-edge p-6 text-sm text-muted-foreground">
          {loadFailed ? "The calendar policy could not be loaded." : "Loading..."}
          {loadFailed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoadFailed(false);
                void load();
              }}
            >
              Retry
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-surface shadow-edge divide-y divide-border/60">
          <PolicyRow
            title="Who can create team calendars"
            detail="Team calendars start with co-admins, so they keep working when someone leaves. Every member can still share their own calendars with people and groups."
            value={form.teamCalendarCreators}
            onChange={(value) => setDraft({ ...form, teamCalendarCreators: value })}
            disabled={disabled}
          />
          <PolicyRow
            title="Who can share a calendar with the whole organization"
            detail="Sharing with specific people and groups stays open to every calendar admin."
            value={form.orgWideCalendarSharers}
            onChange={(value) => setDraft({ ...form, orgWideCalendarSharers: value })}
            disabled={disabled}
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={disabled || !draft} loading={saving}>
          Save changes
        </Button>
        {!isAdmin && (
          <span className="text-xs text-muted-foreground">
            You need owner or admin role to change these settings.
          </span>
        )}
      </div>
    </div>
  );
}

interface PolicyRowProps {
  title: string;
  detail: string;
  value: CalendarPolicyAudience;
  onChange: (value: CalendarPolicyAudience) => void;
  disabled: boolean;
}

function PolicyRow({ title, detail, value, onChange, disabled }: PolicyRowProps) {
  return (
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{detail}</p>
      </div>
      <div className="shrink-0">
        <Select
          value={value}
          onChange={onChange}
          options={AUDIENCE_OPTIONS}
          disabled={disabled}
          triggerClassName="w-full sm:w-64"
          ariaLabel={title}
        />
      </div>
    </div>
  );
}
