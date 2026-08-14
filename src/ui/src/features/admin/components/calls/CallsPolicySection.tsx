import { useCallback, useEffect, useState } from "react";
import { Phone, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppSelector } from "@/app/hooks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { friendlyErrorMessage } from "@/config";
import { callsApi } from "@/features/calls/api/callsApi";
import { NumberInput } from "@/components/ui/number-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { ScreenShareQuality } from "@uniffy/proto/calls/v1/calls_pb";

interface PolicyForm {
  callsEnabled: boolean;
  maxParticipants: number;
  maxDurationMinutes: number;
  maxScreenShareQualityDirect: ScreenShareQuality;
  maxScreenShareQualityGroup: ScreenShareQuality;
  maxScreenShareQualityChannel: ScreenShareQuality;
}

const QUALITY_OPTIONS: SelectOption<ScreenShareQuality>[] = [
  { value: ScreenShareQuality.UNSPECIFIED, label: "No cap (per-type default)" },
  { value: ScreenShareQuality.BALANCED, label: "Balanced (1080p, ~6 Mbps)" },
  { value: ScreenShareQuality.HIGH, label: "High (1080p, ~10 Mbps)" },
  { value: ScreenShareQuality.MAX, label: "Maximum (native, ~16 Mbps)" },
];

const QUALITY_CALL_TYPES: {
  key:
    | "maxScreenShareQualityDirect"
    | "maxScreenShareQualityGroup"
    | "maxScreenShareQualityChannel";
  label: string;
}[] = [
  { key: "maxScreenShareQualityDirect", label: "Direct (1:1)" },
  { key: "maxScreenShareQualityGroup", label: "Group DM" },
  { key: "maxScreenShareQualityChannel", label: "Channel" },
];

export function CallsPolicySection() {
  useDocumentTitle("Calls");
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const role = useAppSelector((state) => state.auth.currentOrganizationRole);
  const isAdmin = role === "OWNER" || role === "ADMIN";

  const [form, setForm] = useState<PolicyForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await callsApi.getOrgCallPolicy({ organizationId });
      const policy = response.policy;
      setForm(
        policy
          ? {
              callsEnabled: policy.callsEnabled,
              maxParticipants: policy.maxParticipants,
              maxDurationMinutes: policy.maxDurationMinutes,
              maxScreenShareQualityDirect: policy.maxScreenShareQualityDirect,
              maxScreenShareQualityGroup: policy.maxScreenShareQualityGroup,
              maxScreenShareQualityChannel: policy.maxScreenShareQualityChannel,
            }
          : null,
      );
    } catch (err) {
      setError(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not load call policy",
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetch on mount; reload raises the loading flag before awaiting the API
    void reload();
  }, [reload]);

  const save = async () => {
    if (!organizationId || !form || saving) return;
    setSaving(true);
    try {
      const response = await callsApi.updateOrgCallPolicy({ organizationId, ...form });
      const policy = response.policy;
      if (policy) {
        setForm({
          callsEnabled: policy.callsEnabled,
          maxParticipants: policy.maxParticipants,
          maxDurationMinutes: policy.maxDurationMinutes,
          maxScreenShareQualityDirect: policy.maxScreenShareQualityDirect,
          maxScreenShareQualityGroup: policy.maxScreenShareQualityGroup,
          maxScreenShareQualityChannel: policy.maxScreenShareQualityChannel,
        });
      }
      toast.success("Call policy saved");
    } catch (err) {
      toast.error(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not save call policy",
      );
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const disabled = !isAdmin || saving;

  return (
    <div className="space-y-6 w-full mx-auto max-w-3xl">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Phone size={24} weight="duotone" className="text-primary shrink-0" />
          <h1 className="text-xl md:text-2xl font-bold">Calls</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Control voice and video calls for this organization. The screen-share ceiling caps how
          much a sharer may broadcast. Viewers on weaker networks still step down automatically; a
          1:1 direct call defaults to the maximum since it has a single viewer.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-border">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--status-error)" }}>
            <Warning size={20} weight="fill" />
            {error}
          </div>
        </div>
      )}

      {loading || !form ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          <Row
            title="Calls enabled"
            description="Turn calling on or off for the whole organization."
          >
            <Toggle
              enabled={form.callsEnabled}
              onChange={(v) => update("callsEnabled", v)}
              disabled={disabled}
            />
          </Row>

          <div className="p-5">
            <h3 className="text-sm font-semibold text-foreground">Maximum screen-share quality</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              The highest tier a member may broadcast, set per call type. Higher tiers use more of
              the media server's outbound bandwidth per viewer. &ldquo;No cap&rdquo; uses the
              built-in default for that type: direct 1:1 calls default to maximum, group and channel
              calls to balanced.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {QUALITY_CALL_TYPES.map(({ key, label }) => (
                <div
                  key={key}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-sm text-foreground">{label}</span>
                  <Select
                    value={form[key]}
                    onChange={(v) => update(key, v)}
                    options={QUALITY_OPTIONS}
                    disabled={disabled}
                    triggerClassName="w-full sm:w-64"
                  />
                </div>
              ))}
            </div>
          </div>

          <Row
            title="Maximum participants"
            description="Cap on how many people can be in a single call (1 to 1000)."
          >
            <ClampedNumberInput
              value={form.maxParticipants}
              min={1}
              max={1000}
              onChange={(v) => update("maxParticipants", v)}
              disabled={disabled}
            />
          </Row>

          <Row
            title="Maximum duration (minutes)"
            description="Calls auto-end after this many minutes (1 to 1440)."
          >
            <ClampedNumberInput
              value={form.maxDurationMinutes}
              min={1}
              max={1440}
              onChange={(v) => update("maxDurationMinutes", v)}
              disabled={disabled}
            />
          </Row>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={disabled || !form}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        {!isAdmin && (
          <span className="text-xs text-muted-foreground">
            You need owner or admin role to change these settings.
          </span>
        )}
      </div>
    </div>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 p-5">
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ClampedNumberInput({
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <NumberInput
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => {
        const parsed = Number(e.target.value);
        if (Number.isNaN(parsed)) return;
        onChange(Math.min(max, Math.max(min, Math.round(parsed))));
      }}
      className="w-28"
    />
  );
}

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      aria-pressed={enabled}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        enabled ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
