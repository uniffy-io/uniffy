import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  selectCurrentOrganization,
  selectOrganizationsStatus,
} from "@/features/auth/store/organizationsSlice";
import { fetchMyOrganizations } from "@/features/auth/store/organizationsThunks";
import { OnboardingShell } from "@/features/onboarding/components/OnboardingShell";
import { AgentsStep } from "@/features/onboarding/components/steps/AgentsStep";
import { AppearanceStep } from "@/features/onboarding/components/steps/AppearanceStep";
import { LaunchStep } from "@/features/onboarding/components/steps/LaunchStep";
import { MentionDisplayStep } from "@/features/onboarding/components/steps/MentionDisplayStep";
import { MentionsStep } from "@/features/onboarding/components/steps/MentionsStep";
import { SharingStep } from "@/features/onboarding/components/steps/SharingStep";
import { TeamStep } from "@/features/onboarding/components/steps/TeamStep";
import { WelcomeStep } from "@/features/onboarding/components/steps/WelcomeStep";
import { buildScene } from "@/features/onboarding/scenes";
import { preloadDestination } from "@/features/onboarding/launch/destinations";
import { enterThroughPortal } from "@/components/orbit/launch/launchCurtain";
import {
  DEFAULT_SHARING_PRESET,
  selectStoredSharingPreset,
  type SharingPreset,
} from "@/features/onboarding/sharing";
import {
  onboardingStepShown,
  selectOnboardingFor,
  selectOnboardingSettled,
  selectConfiguredProvider,
} from "@/features/onboarding/store/onboardingSlice";
import type { InviteOutcome } from "@/features/onboarding/store/onboardingSetupThunks";
import {
  fetchOnboarding,
  finishOnboarding,
  recordOnboardingStep,
} from "@/features/onboarding/store/onboardingThunks";
import { ONBOARDING_STEPS, stepIndex, type OnboardingStepId } from "@/features/onboarding/steps";
import "@/features/onboarding/styles/onboarding.css";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import type { MentionDisplayMode } from "@/components/mention/mentionStateContext";

export function OnboardingPage() {
  useDocumentTitle("Welcome");
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const organizationSlug = useAppSelector((state) => state.auth.currentOrganizationSlug) ?? "";
  const isOwner = useAppSelector((state) => state.auth.currentOrganizationRole === "OWNER");
  const organization = useAppSelector(selectCurrentOrganization);
  const organizationsStatus = useAppSelector(selectOrganizationsStatus);
  const onboarding = useAppSelector((state) => selectOnboardingFor(state, organizationId));
  const settled = useAppSelector((state) => selectOnboardingSettled(state, organizationId));
  const storedSharing = useAppSelector(selectStoredSharingPreset);
  const provider = useAppSelector(selectConfiguredProvider);
  const mentionDisplaySetting = useAppSelector(
    (state) => state.settings.effectiveSettings?.appearance.mentionDisplay,
  );

  const [sharingPick, setSharingPick] = useState<SharingPreset | null>(null);
  const [invitees, setInvitees] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, InviteOutcome>>({});
  const [launching, setLaunching] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const orbitRef = useRef<HTMLDivElement>(null);

  const organizationName = organization?.name ?? organizationSlug;
  // Keep the last screen mounted through the launch animation after completion.
  const step: OnboardingStepId | null =
    onboarding && (onboarding.pending || launching) ? onboarding.currentStep : null;
  const sharing = sharingPick ?? storedSharing ?? DEFAULT_SHARING_PRESET;
  // The settings default is expanded, so anything but an explicit compact reads as expanded.
  const mentionDisplay: MentionDisplayMode =
    mentionDisplaySetting === "compact" ? "compact" : "expanded";

  useEffect(() => {
    if (organizationId && isOwner) void dispatch(fetchOnboarding(organizationId));
  }, [dispatch, organizationId, isOwner]);

  useEffect(() => {
    if (organizationsStatus === "idle") void dispatch(fetchMyOrganizations());
  }, [dispatch, organizationsStatus]);

  const scene = useMemo(
    () =>
      buildScene({
        step: step ?? "welcome",
        organizationSlug: organizationSlug || "workspace",
        sharing,
        agentConnected: provider !== null,
        invitees,
        launching,
        mentionDisplay,
      }),
    [step, organizationSlug, sharing, provider, invitees, launching, mentionDisplay],
  );

  const goTo = useCallback(
    (next: OnboardingStepId) => {
      if (!organizationId) return;
      dispatch(onboardingStepShown({ organizationId, step: next }));
      void dispatch(recordOnboardingStep({ organizationId, step: next }));
    },
    [dispatch, organizationId],
  );

  const advance = (offset: number) => {
    if (!step) return;
    const target = ONBOARDING_STEPS[stepIndex(step) + offset];
    if (target) goTo(target.id);
  };

  const finish = async (dismissed: boolean, destination: string) => {
    if (!organizationId || launching) return;
    setLaunching(true);
    try {
      await dispatch(finishOnboarding({ organizationId, dismissed })).unwrap();
    } catch {
      setLaunching(false);
      return;
    }
    preloadDestination(destination);
    await enterThroughPortal(orbitRef.current);
    navigate(destination, { replace: true });
  };

  const recordOutcomes = (results: InviteOutcome[]) =>
    setOutcomes((current) => ({
      ...current,
      ...Object.fromEntries(results.map((result) => [result.email, result])),
    }));

  if (!organizationId || !isOwner || settled === "failed") return <Navigate to="/" replace />;
  if (onboarding && !onboarding.pending && !launching) return <Navigate to="/" replace />;

  const next = () => advance(1);
  const back = () => advance(-1);
  const invited = Object.values(outcomes).filter((outcome) => outcome.error === null).length;

  return (
    <OnboardingShell
      scene={scene}
      orbitRef={orbitRef}
      step={step}
      organizationName={organizationName}
      launching={launching}
      onSkip={step && step !== "launch" && !launching ? () => setConfirmSkip(true) : null}
    >
      <div key={step ?? "loading"} className="h-full">
        {step === "welcome" && (
          <WelcomeStep
            organizationName={organizationName}
            organizationSlug={organizationSlug}
            onNext={next}
          />
        )}
        {step === "mentions" && <MentionsStep onNext={next} onBack={back} />}
        {step === "mentionDisplay" && (
          <MentionDisplayStep value={mentionDisplay} onNext={next} onBack={back} />
        )}
        {step === "sharing" && (
          <SharingStep
            preset={sharing}
            onPresetChange={setSharingPick}
            onNext={next}
            onBack={back}
          />
        )}
        {step === "appearance" && <AppearanceStep onNext={next} onBack={back} />}
        {step === "agents" && <AgentsStep onNext={next} onBack={back} />}
        {step === "team" && (
          <TeamStep
            invitees={invitees}
            onInviteesChange={setInvitees}
            outcomes={outcomes}
            onOutcomes={recordOutcomes}
            onNext={next}
            onBack={back}
          />
        )}
        {step === "launch" && (
          <LaunchStep
            organizationName={organizationName}
            organizationSlug={organizationSlug}
            sharing={sharing}
            provider={provider}
            mentionDisplay={mentionDisplay}
            invited={invited}
            launching={launching}
            onLaunch={(destination) => finish(false, destination)}
            onBack={back}
          />
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmSkip}
        onClose={() => setConfirmSkip(false)}
        onConfirm={() => {
          setConfirmSkip(false);
          void finish(true, "/");
        }}
        title="Skip the rest of setup?"
        message="Everything you set so far stays. The rest lives in organization settings whenever you want it."
        confirmLabel="Skip setup"
        cancelLabel="Keep going"
        variant="default"
      />
    </OnboardingShell>
  );
}
