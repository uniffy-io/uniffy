import { useState } from "react";
import { ChatCircle, Link as LinkIcon, ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import { cn } from "@/shared/utils/cn";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { usePresence } from "@/features/presence/hooks/usePresence";
import { useAvatarUrl } from "@/shared/hooks/useAvatarUrl";
import { avatarUrlAtVariant } from "@/shared/utils/fileUrls";
import { PresenceIndicator } from "@/components/subject";
import { getAvatarGradientStyle, getInitials } from "@/components/subject/utils";
import { Button } from "@/components/ui/button";
import type { SerializedPersonProfile } from "@/features/people/store/peopleThunks";

interface ProfileHeaderProps {
  person: SerializedPersonProfile;
  onMessage: () => void;
  messagePending: boolean;
}

const PRESENCE_LABELS: Record<string, string> = {
  online: "Online",
  away: "Away",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

const PRESENCE_COLORS: Record<string, string> = {
  online: "text-green-600 dark:text-green-400",
  away: "text-amber-600 dark:text-amber-400",
  dnd: "text-red-600 dark:text-red-400",
  offline: "text-muted-foreground",
};

export function ProfileHeader({ person, onMessage, messagePending }: ProfileHeaderProps) {
  const presenceStatus = usePresence(person.userId);
  const resolvedAvatarUrl = useAvatarUrl(person.userId, "lg");
  const [imgFailed, setImgFailed] = useState(false);
  // Either source can be a step behind an upload, and either URL can 404 before
  // the member cache is warm, so a load error is what drops this to initials.
  const personAvatarUrl = person.avatarUrl ? avatarUrlAtVariant(person.avatarUrl, "lg") : null;
  const avatarSrc = imgFailed ? null : personAvatarUrl || resolvedAvatarUrl;

  const handleCopyLink = () => {
    navigator.clipboard
      .writeText(`${window.location.origin}/people/${person.userId}`)
      .then(() => toast.success("Profile link copied"))
      .catch(() => toast.error("Failed to copy link"));
  };

  const roleBadge =
    person.orgRole === OrganizationRole.OWNER
      ? {
          label: "Owner",
          className:
            "bg-gradient-to-r from-amber-100 to-amber-200 text-amber-700 dark:from-amber-950 dark:to-amber-900 dark:text-amber-300",
        }
      : person.orgRole === OrganizationRole.ADMIN
        ? {
            label: "Admin",
            className:
              "bg-gradient-to-r from-blue-100 to-blue-200 text-blue-700 dark:from-blue-950 dark:to-blue-900 dark:text-blue-300",
          }
        : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative shrink-0">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={person.displayName}
              onError={() => setImgFailed(true)}
              className="h-16 w-16 rounded-xl object-cover shadow-lg ring-2 ring-background"
            />
          ) : (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-xl text-lg font-semibold text-white shadow-lg"
              style={getAvatarGradientStyle(person.displayName || person.userId)}
            >
              {getInitials(person.displayName)}
            </div>
          )}
          <PresenceIndicator status={presenceStatus} size="lg" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-foreground">{person.displayName}</h1>
            {person.pronouns && (
              <span className="text-sm text-muted-foreground">{person.pronouns}</span>
            )}
            {roleBadge && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  roleBadge.className,
                )}
              >
                <ShieldCheck size={12} weight="fill" />
                {roleBadge.label}
              </span>
            )}
            {!person.isActive && (
              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                Inactive
              </span>
            )}
          </div>

          {(person.jobTitle || person.department) && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[person.jobTitle, person.department].filter(Boolean).join(" · ")}
            </p>
          )}
          {person.username && (
            <p className="mt-0.5 text-xs text-muted-foreground/70">@{person.username}</p>
          )}
          <p
            className={cn(
              "mt-1 text-xs font-medium",
              PRESENCE_COLORS[presenceStatus] ?? "text-muted-foreground",
            )}
          >
            {PRESENCE_LABELS[presenceStatus] ?? "Offline"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!person.isSelf && (
            <Button size="md" onClick={onMessage} loading={messagePending}>
              <ChatCircle size={14} weight="fill" />
              Message
            </Button>
          )}
          <Button variant="outline" size="md" onClick={handleCopyLink}>
            <LinkIcon size={14} weight="bold" />
            Copy link
          </Button>
        </div>
      </div>
    </div>
  );
}
