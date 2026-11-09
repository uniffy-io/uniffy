import { useEffect, useState } from "react";
import { Check, Copy, Info } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { ProviderMark } from "@/features/calendar/components/connections/ProviderMark";
import {
  fetchCalendarProviderSettings,
  updateCalendarProviderSettings,
} from "@/features/calendar/store/calendarConnectionsThunks";
import type { ProviderAppSettingsInfo } from "@/features/calendar/types";
import { credentialSourceCopy, providerName } from "@/features/calendar/utils/connectionCopy";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

/** The Google and Microsoft apps members sign in through: the deployment's, or this organization's own. */
export function CalendarProviderApps() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((state) => state.calendarConnections.providerSettings);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    void dispatch(fetchCalendarProviderSettings());
  }, [dispatch]);

  if (!settings) return null;

  return (
    <section className="space-y-4" data-testid="calendar-provider-apps">
      <div>
        <h2 className="text-base font-semibold text-foreground">Google and Microsoft apps</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Members sign in through an OAuth app. Use the deployment's app, or register your own and
          enter its credentials here.
        </p>
      </div>

      {settings.redirectUri && (
        <div className="rounded-xl bg-surface p-5 shadow-edge">
          <p className="mb-1 text-sm text-muted-foreground">Redirect URI</p>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 truncate rounded-md bg-input px-3 py-2 text-xs"
              title={settings.redirectUri}
            >
              {settings.redirectUri}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={() => void copy(settings.redirectUri)}
              aria-label="Copy redirect URI"
            >
              {copied ? <Check size={16} weight="bold" /> : <Copy size={16} weight="duotone" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-subtle-foreground">
            Register this address as an authorized redirect URI in each app.
          </p>
        </div>
      )}

      {settings.providers.map((provider) => (
        <ProviderAppCard key={provider.provider} settings={provider} />
      ))}
    </section>
  );
}

function ProviderAppCard({ settings }: { settings: ProviderAppSettingsInfo }) {
  const dispatch = useAppDispatch();
  const ownApp = settings.source === "organization";
  const [clientId, setClientId] = useState(settings.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [tenant, setTenant] = useState(settings.tenant);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<"save" | "clear" | null>(null);
  const name = providerName(settings.provider);
  const microsoft = settings.provider === "microsoft";
  const clearLabel = settings.deploymentConfigured ? "Use deployment app" : "Clear";

  const changed =
    clientId.trim() !== settings.clientId ||
    clientSecret !== "" ||
    (microsoft && tenant.trim() !== settings.tenant);
  // A new app needs its secret; an organization app already stored keeps its own when left empty.
  const canSave = clientId.trim() !== "" && changed && (ownApp || clientSecret !== "");
  // Another app means every token issued by the current one stops working; a new secret alone does not.
  const signsMembersOut =
    settings.source === "deployment" || (ownApp && clientId.trim() !== settings.clientId);

  const save = async (clear: boolean) => {
    setConfirming(null);
    setSaving(true);
    const outcome = await dispatch(
      updateCalendarProviderSettings(
        clear
          ? { provider: settings.provider, clear: true }
          : {
              provider: settings.provider,
              clientId: clientId.trim(),
              clientSecret,
              tenant: microsoft ? tenant.trim() : "",
            },
      ),
    );
    setSaving(false);
    if (!updateCalendarProviderSettings.fulfilled.match(outcome)) return;
    const stored = outcome.payload.providers.find((entry) => entry.provider === settings.provider);
    setClientId(stored?.clientId ?? "");
    setTenant(stored?.tenant ?? "");
    setClientSecret("");
    toast.success(clear ? `${name} app removed` : `${name} app saved`);
  };

  return (
    <div className="rounded-xl bg-surface p-5 shadow-edge" data-testid="provider-app-card">
      <div className="mb-4 flex items-center gap-2">
        <ProviderMark provider={settings.provider} size={18} />
        <h3 className="text-sm font-semibold text-foreground">{name}</h3>
        <span className="ml-auto text-xs text-subtle-foreground">
          {credentialSourceCopy(settings.source)}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-muted-foreground">Client ID</span>
          <Input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={saving}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-muted-foreground">Client secret</span>
          <Input
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder={settings.clientSecretHint ? `••••${settings.clientSecretHint}` : ""}
            autoComplete="new-password"
            disabled={saving}
          />
          {ownApp && settings.clientSecretHint && (
            <span className="mt-1 block text-xs text-subtle-foreground">
              Leave empty to keep the stored secret.
            </span>
          )}
        </label>
        {microsoft && (
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm text-muted-foreground">
              Tenant <span className="text-subtle-foreground">(optional)</span>
            </span>
            <Input
              value={tenant}
              onChange={(event) => setTenant(event.target.value)}
              placeholder="common"
              autoComplete="off"
              spellCheck={false}
              disabled={saving}
            />
            <span className="mt-1 block text-xs text-subtle-foreground">
              A tenant ID limits sign-in to accounts of one Microsoft organization.
            </span>
          </label>
        )}
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs text-subtle-foreground">
        <Info size={14} weight="duotone" className="mt-0.5 shrink-0" />
        Changing the app means everyone who connected {name} must connect their account again before
        their calendars sync.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => (signsMembersOut ? setConfirming("save") : void save(false))}
          disabled={!canSave}
          loading={saving}
        >
          Save
        </Button>
        {ownApp && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirming("clear")}
            disabled={saving}
          >
            {clearLabel}
          </Button>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => void save(confirming === "clear")}
        title={
          confirming !== "clear"
            ? `Switch the ${name} app?`
            : settings.deploymentConfigured
              ? `Use the deployment's ${name} app?`
              : `Clear the ${name} app?`
        }
        message={`Members of this organization who connected ${name} through the current app will need to sign in again before their calendars sync.`}
        confirmLabel={confirming === "clear" ? clearLabel : "Save"}
        variant="warning"
        loading={saving}
      />
    </div>
  );
}
