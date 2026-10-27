import { useEffect, useState } from "react";
import { CheckCircle, Plugs, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Input } from "@/components/ui/input";
import { ProviderPicker } from "@/features/agents/components/ProviderPicker";
import { providerBrand } from "@/features/agents/config/providerBrands";
import { fetchProviderKeys } from "@/features/agents/store/agentProvidersThunks";
import { fetchRuntimeSettings } from "@/features/admin/store/agentRuntimeSettingsThunks";
import { summarizeKeyError } from "@/features/agents/utils/providerKeyErrors";
import { Eyebrow, StepActions, StepFrame } from "@/features/onboarding/components/StepFrame";
import { stagger } from "@/components/orbit/stagger";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/utils/cn";
import {
  selectConfiguredProvider,
  selectOnboardingProviderKey,
} from "@/features/onboarding/store/onboardingSlice";
import {
  connectProvider,
  type ProviderConnection,
} from "@/features/onboarding/store/onboardingSetupThunks";

interface AgentsStepProps {
  onNext: () => void;
  onBack: () => void;
}

const GUARANTEES = [
  "An agent reads only what the person asking can read.",
  "Nothing goes to a model until you connect a provider.",
  "Your key is encrypted with a key that belongs to this organization.",
];

export function AgentsStep({ onNext, onBack }: AgentsStepProps) {
  const dispatch = useAppDispatch();
  const connectedProvider = useAppSelector(selectConfiguredProvider);
  const savedKey = useAppSelector(selectOnboardingProviderKey);
  const loadingKeys = useAppSelector((state) => state.agentProviders.keysStatus === "loading");
  const [provider, setProvider] = useState("anthropic");
  const [credential, setCredential] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [result, setResult] = useState<ProviderConnection | null>(null);
  const body = stagger(3);
  const brand = providerBrand(provider);
  const ready = connectedProvider !== null;
  const pendingKeyId =
    result?.status === "failed" || result?.status === "no_models"
      ? (result.keyId ?? savedKey?.id)
      : savedKey?.id;

  const connect = async () => {
    if ((!pendingKeyId && !credential.trim()) || connecting || loadingKeys) return;
    setConnecting(true);
    const outcome = await dispatch(
      connectProvider(
        pendingKeyId
          ? { keyId: pendingKeyId }
          : {
              provider,
              label: `${brand?.label ?? provider} key`,
              credential: credential.trim(),
              replaceKeyId: result?.status === "rejected" ? result.keyId : null,
            },
      ),
    );
    setConnecting(false);
    setResult(outcome);
    if (outcome.status !== "rejected" && outcome.keyId) setCredential("");
    return outcome;
  };

  useEffect(() => {
    void dispatch(fetchProviderKeys());
    void dispatch(fetchRuntimeSettings());
  }, [dispatch]);

  const rejection =
    result?.status === "rejected"
      ? summarizeKeyError(result.error, brand?.label ?? provider)
      : null;

  return (
    <StepFrame
      eyebrow={<Eyebrow>AI that knows its place</Eyebrow>}
      title={
        <>
          Agents that follow <span className="text-primary">your permissions</span>.
        </>
      }
      lede={
        <>
          Ask NavigatorAgent where something is, who owns it, or what changed. Build your own agents
          later. Bring a key from the provider you trust. No key means no AI, and that is a fine
          place to start.
        </>
      }
      actions={
        <StepActions
          index={8}
          primaryLabel={
            !ready && (pendingKeyId || credential.trim()) ? "Connect and continue" : "Continue"
          }
          busy={connecting}
          primaryDisabled={loadingKeys}
          onPrimary={async () => {
            if (!ready && (pendingKeyId || credential.trim())) {
              const outcome = await connect();
              if (outcome?.status === "connected") onNext();
              return;
            }
            onNext();
          }}
          onBack={onBack}
          onSkip={ready ? undefined : onNext}
          skipLabel="Set up AI later"
        />
      }
    >
      <div className={cn("space-y-5", body.className)} style={body.style}>
        <ul className="grid gap-1.5">
          {GUARANTEES.map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <ShieldCheck size={16} weight="duotone" className="mt-0.5 shrink-0 text-primary" />
              {line}
            </li>
          ))}
        </ul>

        {ready ? (
          <div className="flex items-center gap-3 rounded-xl bg-surface p-4 shadow-edge">
            <CheckCircle
              size={22}
              weight="fill"
              className="shrink-0 text-green-600 dark:text-green-400"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {providerBrand(connectedProvider ?? provider)?.label ?? "Your provider"} is
                connected.
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {result?.status === "connected" && result.modelName
                  ? `NavigatorAgent answers with ${result.modelName}. Change it in the agents settings.`
                  : "NavigatorAgent is ready in chat."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 rounded-xl bg-surface p-4 shadow-edge">
            {pendingKeyId ? (
              <p className="text-sm text-muted-foreground">
                Your provider key is saved. Finish model setup to use NavigatorAgent.
              </p>
            ) : (
              <ProviderPicker value={provider} onChange={setProvider} />
            )}
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              {!pendingKeyId && (
                <Input
                  type="password"
                  autoComplete="off"
                  value={credential}
                  onChange={(event) => setCredential(event.target.value)}
                  placeholder={brand?.credentialPlaceholder ?? "API key"}
                  aria-label={`${brand?.label ?? "Provider"} API key`}
                  className="font-mono"
                />
              )}
              <Button
                type="submit"
                variant="outline"
                size="lg"
                disabled={loadingKeys || (!pendingKeyId && !credential.trim())}
                loading={connecting}
                className="shrink-0"
              >
                <Plugs size={16} />
                {pendingKeyId ? "Finish setup" : "Connect"}
              </Button>
            </form>
            {result?.status === "failed" && (
              <p className="text-sm text-destructive">Setup could not finish. Try again.</p>
            )}
            {result?.status === "no_models" && (
              <p className="text-sm text-destructive">
                No compatible chat model is available for this key. Check provider access, then
                retry.
              </p>
            )}
            {rejection && (
              <div className="flex items-start gap-2 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-400">
                <WarningCircle size={16} className="mt-0.5 shrink-0" />
                <span>
                  {rejection.headline}
                  {rejection.detail && (
                    <span className="mt-1 block text-xs opacity-80">{rejection.detail}</span>
                  )}
                </span>
              </div>
            )}
            <p className="text-xs text-subtle-foreground">
              Pasted once and encrypted at rest. It is never shown again, so keep your own copy.
            </p>
          </div>
        )}
      </div>
    </StepFrame>
  );
}
