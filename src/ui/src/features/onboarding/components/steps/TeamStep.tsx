import { useState } from "react";
import { CheckCircle, EnvelopeSimple, WarningCircle, X } from "@phosphor-icons/react";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { useAppDispatch } from "@/app/hooks";
import { identityPaint } from "@/config/theme/brandGradients";
import { stagger } from "@/components/orbit/stagger";
import { controlShellClass } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Eyebrow, StepActions, StepFrame } from "@/features/onboarding/components/StepFrame";
import { inviteTeam, type InviteOutcome } from "@/features/onboarding/store/onboardingSetupThunks";
import { cn } from "@/shared/utils/cn";

interface TeamStepProps {
  invitees: string[];
  onInviteesChange: (emails: string[]) => void;
  outcomes: Record<string, InviteOutcome>;
  onOutcomes: (outcomes: InviteOutcome[]) => void;
  onNext: () => void;
  onBack: () => void;
}

const MAX_INVITEES = 20;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
type InviteRole = "member" | "admin";

const ROLE_FOR: Record<InviteRole, OrganizationRole> = {
  member: OrganizationRole.MEMBER,
  admin: OrganizationRole.ADMIN,
};

function splitAddresses(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function TeamStep({
  invitees,
  onInviteesChange,
  outcomes,
  onOutcomes,
  onNext,
  onBack,
}: TeamStepProps) {
  const dispatch = useAppDispatch();
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const body = stagger(3);

  const unsent = invitees.filter((email) => outcomes[email]?.error !== null);

  const commit = (raw: string) => {
    const addresses = splitAddresses(raw);
    if (addresses.length === 0) return;
    const bad = addresses.find((address) => !EMAIL.test(address));
    const good = addresses.filter((address) => EMAIL.test(address) && !invitees.includes(address));
    onInviteesChange([...invitees, ...good].slice(0, MAX_INVITEES));
    setInvalid(bad ?? null);
    setDraft(bad ?? "");
  };

  const remove = (email: string) => onInviteesChange(invitees.filter((entry) => entry !== email));

  const send = async () => {
    const typed = splitAddresses(draft).filter(
      (address) => EMAIL.test(address) && !invitees.includes(address),
    );
    const pending = [...unsent, ...typed];
    if (draft.trim()) commit(draft);
    if (pending.length === 0) {
      onNext();
      return;
    }
    setSending(true);
    const results = await dispatch(inviteTeam({ emails: pending, role: ROLE_FOR[role] })).unwrap();
    setSending(false);
    onOutcomes(results);
    if (results.every((result) => result.error === null)) onNext();
  };

  const pendingCount = unsent.length + (draft.trim() && EMAIL.test(draft.trim()) ? 1 : 0);

  return (
    <StepFrame
      eyebrow={<Eyebrow>Better together</Eyebrow>}
      title={
        <>
          Bring your <span className="text-primary">people</span>.
        </>
      }
      lede={
        <>
          Invite the people you work with. Each address gets an invitation. People with verified
          email addresses also see it when they sign in, even if mail is not set up yet.
        </>
      }
      actions={
        <StepActions
          index={8}
          primaryLabel={
            pendingCount > 0
              ? `Send ${pendingCount} ${pendingCount === 1 ? "invitation" : "invitations"}`
              : "Continue"
          }
          busy={sending}
          onPrimary={send}
          onBack={onBack}
          onSkip={pendingCount > 0 ? onNext : undefined}
          skipLabel="Invite people later"
        />
      }
    >
      <div className={cn("space-y-4", body.className)} style={body.style}>
        <label
          className={cn(
            controlShellClass,
            "focus-ring-within flex min-h-11 cursor-text flex-wrap items-center gap-1.5 px-2.5 py-1.5",
          )}
        >
          <EnvelopeSimple size={16} className="shrink-0 text-muted-foreground" />
          {invitees.map((email) => {
            const outcome = outcomes[email];
            const paint = identityPaint(email);
            return (
              <span
                key={email}
                title={outcome?.error ?? undefined}
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1.5 text-xs",
                  outcome?.error
                    ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-muted text-foreground",
                )}
              >
                <span
                  className="h-4 w-4 shrink-0 rounded-full"
                  style={{ background: paint.gradient }}
                />
                <span className="truncate">{email}</span>
                {outcome?.error === null ? (
                  <CheckCircle
                    size={14}
                    weight="fill"
                    className="shrink-0 text-green-600 dark:text-green-400"
                  />
                ) : outcome?.error ? (
                  <WarningCircle size={14} className="shrink-0" />
                ) : null}
                {outcome?.error !== null && (
                  <button
                    type="button"
                    onClick={() => remove(email)}
                    className="focus-ring rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${email}`}
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            );
          })}
          <input
            value={draft}
            onChange={(event) => {
              setInvalid(null);
              const value = event.target.value;
              if (/[\s,;]$/.test(value)) commit(value);
              else setDraft(value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(draft);
              } else if (event.key === "Backspace" && !draft && invitees.length > 0) {
                const last = invitees[invitees.length - 1];
                if (outcomes[last]?.error !== null) remove(last);
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              commit(`${draft} ${event.clipboardData.getData("text")}`);
            }}
            onBlur={() => draft.trim() && commit(draft)}
            disabled={invitees.length >= MAX_INVITEES}
            placeholder={
              invitees.length === 0 ? "name@company.com, another@company.com" : "Add another"
            }
            aria-label="Email addresses to invite"
            className="min-w-[12rem] flex-1 bg-transparent px-1 py-1 text-sm text-foreground placeholder:text-subtle-foreground focus:outline-none"
          />
        </label>

        {invalid && (
          <p className="text-xs text-destructive">{invalid} does not look like an email address.</p>
        )}
        {Object.values(outcomes).some((outcome) => outcome.error) && (
          <ul className="space-y-1">
            {Object.values(outcomes)
              .filter((outcome) => outcome.error)
              .map((outcome) => (
                <li key={outcome.email} className="text-xs text-destructive">
                  {outcome.email}: {outcome.error}
                </li>
              ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Join as</span>
          <SegmentedControl<InviteRole>
            value={role}
            onChange={setRole}
            ariaLabel="Role for these invitations"
            options={[
              { value: "member", content: <span className="px-2 text-xs">Members</span> },
              { value: "admin", content: <span className="px-2 text-xs">Admins</span> },
            ]}
          />
          <span className="text-xs text-subtle-foreground">
            Admins manage members and settings. They do not see private content.
          </span>
        </div>
      </div>
    </StepFrame>
  );
}
