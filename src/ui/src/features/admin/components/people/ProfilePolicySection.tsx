import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Warning } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { friendlyErrorMessage } from "@/config";
import { peopleApi } from "@/features/people/api/peopleApi";
import { ToggleSwitch } from "@/components/ui/toggle-switch";

interface PolicyForm {
  directoryEnabled: boolean;
  orgChartEnabled: boolean;
}

export function ProfilePolicySection() {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const [form, setForm] = useState<PolicyForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await peopleApi.getProfilePolicy(organizationId);
      const policy = response.policy;
      setForm(
        policy
          ? {
              directoryEnabled: policy.directoryEnabled,
              orgChartEnabled: policy.orgChartEnabled,
            }
          : null,
      );
    } catch (err) {
      setError(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not load the people policy",
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetch on mount; reload raises the loading flag before awaiting the API
    void reload();
  }, [reload]);

  const save = async (next: PolicyForm) => {
    if (!organizationId || saving) return;
    const previous = form;
    setForm(next);
    setSaving(true);
    try {
      await peopleApi.updateProfilePolicy(organizationId, next);
    } catch (err) {
      setForm(previous);
      toast.error(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not save the people policy",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">People surfaces</h2>
        <p className="text-muted-foreground text-sm hidden sm:block">
          Turn the member-facing people surfaces on or off for this organization.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-surface shadow-edge">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--status-error)" }}>
            <Warning size={20} weight="fill" />
            {error}
          </div>
        </div>
      )}

      {loading || !form ? (
        <div className="rounded-xl bg-surface shadow-edge p-5 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : (
        <div className="rounded-xl bg-surface shadow-edge divide-y divide-border">
          <div className="flex items-start gap-4 p-5">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Directory</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Member browsing and people search results. Profiles opened from mention chips keep
                working either way.
              </p>
            </div>
            <ToggleSwitch
              enabled={form.directoryEnabled}
              onChange={(v) => void save({ ...form, directoryEnabled: v })}
              disabled={saving}
            />
          </div>
          <div className="flex items-start gap-4 p-5">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Org chart</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                The /people chart of reporting lines and teams.
              </p>
            </div>
            <ToggleSwitch
              enabled={form.orgChartEnabled}
              onChange={(v) => void save({ ...form, orgChartEnabled: v })}
              disabled={saving}
            />
          </div>
        </div>
      )}
    </section>
  );
}
