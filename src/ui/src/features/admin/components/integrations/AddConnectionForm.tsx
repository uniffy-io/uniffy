import { useMemo, useState } from "react";
import { CircleNotch, Plus, Warning } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntegrationProviderPicker } from "@/features/integrations/components/IntegrationProviderPicker";
import { addConnection } from "@/features/integrations/store/integrationsThunks";
import type { IntegrationProviderPlain } from "@/features/integrations/store/integrationsThunks";

const CREDENTIAL_WRITE_ONCE_NOTE =
  "Pasted once and encrypted at rest. It is never shown again, so keep your own copy.";

export function AddConnectionForm({
  providers,
  onSubmit,
}: {
  providers: IntegrationProviderPlain[];
  onSubmit: (connectionId: string) => void;
}) {
  const dispatch = useAppDispatch();
  const [providerChoice, setProviderChoice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [credential, setCredential] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const provider = providerChoice ?? providers[0]?.id ?? "";
  const descriptor = useMemo(
    () => providers.find((p) => p.id === provider) ?? null,
    [providers, provider],
  );

  const canSubmit =
    Boolean(provider) && Boolean(name.trim()) && Boolean(credential.trim()) && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      // The credential is only judged by the probe the backend runs on
      // save; a rejected token still lands, with the error on the row.
      const connection = await dispatch(
        addConnection({
          provider,
          name: name.trim(),
          credential: credential.trim(),
          baseUrl: baseUrl.trim() || undefined,
        }),
      ).unwrap();
      setName("");
      setBaseUrl("");
      setCredential("");
      onSubmit(connection.id);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-muted-foreground mb-1.5">Service</label>
        <IntegrationProviderPicker
          providers={providers}
          value={provider}
          onChange={setProviderChoice}
        />
      </div>
      <div>
        <label className="block text-sm text-muted-foreground mb-1">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Engineering GitHub"
        />
      </div>
      {descriptor?.supportsBaseUrlOverride && (
        <div>
          <label className="block text-sm text-muted-foreground mb-1">API base URL</label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={descriptor.defaultBaseUrl}
            className="font-mono"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Leave blank for {descriptor.defaultBaseUrl}
          </p>
        </div>
      )}
      <div>
        <label className="block text-sm text-muted-foreground mb-1">Access token</label>
        <Input
          type="password"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          placeholder={descriptor?.credentialPlaceholder || "Access token"}
          className="font-mono"
        />
        <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Warning size={14} className="shrink-0 mt-0.5" />
          <span>{CREDENTIAL_WRITE_ONCE_NOTE}</span>
        </div>
        {descriptor?.credentialDocsUrl && (
          <p className="mt-1 text-xs text-muted-foreground">
            <a
              href={descriptor.credentialDocsUrl}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              How to create a {descriptor.label} token
            </a>
          </p>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? <CircleNotch size={16} className="animate-spin" /> : <Plus size={16} />}
          Add Connection
        </Button>
      </div>
    </form>
  );
}
