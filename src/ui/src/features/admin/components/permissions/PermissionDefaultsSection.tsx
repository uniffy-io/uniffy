import { useEffect, useState } from "react";
import type { Icon } from "@phosphor-icons/react";
import {
  ShieldCheck,
  NotePencil,
  FolderSimple,
  WarningCircle,
  Kanban,
  Robot,
  Buildings,
  LockSimple,
  UsersThree,
  Check,
  X,
} from "@phosphor-icons/react";
import { usePermissionDefaults, getContentTypeLabel } from "@/features/admin/hooks/useAdminHooks";
import { ContentType, AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { AccessModeSelector } from "@/features/permissions";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { cn } from "@/shared/utils/cn";
import type { SerializedContentTypeDefaults } from "@/features/admin/store/adminSlice";

const CONTENT_TYPE_ICONS: Record<number, typeof NotePencil> = {
  [ContentType.NOTE]: NotePencil,
  [ContentType.FILE]: FolderSimple,
  [ContentType.PROJECT]: Kanban,
  [ContentType.AGENT]: Robot,
};

const ALL_CONTENT_TYPES = [
  ContentType.NOTE,
  ContentType.FILE,
  ContentType.PROJECT,
  ContentType.AGENT,
];

const CONTENT_TYPE_DESCRIPTIONS: Partial<Record<number, string>> = {
  [ContentType.AGENT]:
    "Controls who can USE agents in chat, not who can build them. Agents without " +
    "their own sharing setup follow this default live; the baseline role is what " +
    "every member gets, and Viewer is enough to chat with an agent. Stricter than " +
    '"Open to organization" hides agents from members until a builder shares them. ' +
    "Creating and editing agents always requires an org admin or Agents domain " +
    "admin, and provider keys stay admin-managed regardless of this setting.",
};

interface ContentTypeCardProps {
  contentType: number;
  defaults: SerializedContentTypeDefaults | undefined;
  onUpdate: (contentType: number, updates: Partial<SerializedContentTypeDefaults>) => Promise<void>;
}

function ContentTypeCard({ contentType, defaults, onUpdate }: ContentTypeCardProps) {
  const [saving, setSaving] = useState(false);
  const Icon = CONTENT_TYPE_ICONS[contentType] || NotePencil;
  const description = CONTENT_TYPE_DESCRIPTIONS[contentType];

  const handleChange = async (next: { accessMode: AccessMode; baselineRole: number | null }) => {
    setSaving(true);
    try {
      await onUpdate(contentType, {
        defaultAccessMode: next.accessMode,
        defaultBaselineRole: next.baselineRole,
      });
    } finally {
      setSaving(false);
    }
  };

  const updatedIso = defaults?.updatedAt
    ? new Date(Number(defaults.updatedAt.seconds) * 1000).toISOString()
    : undefined;

  return (
    <div className="p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon size={20} weight="duotone" className="text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium">{getContentTypeLabel(contentType)}</h3>
        </div>
        {saving && (
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {description && (
        <p className="text-xs text-muted-foreground leading-snug mb-4">{description}</p>
      )}

      <AccessModeSelector
        value={{
          accessMode: (defaults?.defaultAccessMode ?? AccessMode.OWNER_ONLY) as AccessMode,
          baselineRole: defaults?.defaultBaselineRole ?? null,
        }}
        onChange={handleChange}
      />

      {updatedIso && (
        <p className="text-xs text-muted-foreground mt-3">
          Updated {formatRelativeTime(updatedIso)}
        </p>
      )}
    </div>
  );
}

interface ScopeCardProps {
  icon: Icon;
  name: string;
  description: string;
  applies: boolean;
}

function ScopeCard({ icon: Icon, name, description, applies }: ScopeCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 p-3 rounded-lg border-2 transition-colors",
        applies ? "border-primary bg-primary/5" : "border-dashed border-border bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          size={18}
          weight="duotone"
          className={applies ? "text-primary shrink-0" : "text-muted-foreground shrink-0"}
        />
        <span
          className={cn(
            "text-sm font-medium truncate",
            applies ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {name}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-snug">{description}</p>
      <div
        className={cn(
          "flex items-center gap-1 text-xs font-medium mt-1",
          applies ? "text-primary" : "text-muted-foreground/70",
        )}
      >
        {applies ? (
          <>
            <Check size={12} weight="bold" />
            Defaults apply
          </>
        ) : (
          <>
            <X size={12} weight="bold" />
            Owner-only
          </>
        )}
      </div>
    </div>
  );
}

function ScopeOverview() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground mb-3">
        Defaults below apply only to content created in the{" "}
        <span className="font-medium text-foreground">Organization</span> space. Content in Personal
        Space and Shared With Me stays owner-only regardless.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <ScopeCard
          icon={LockSimple}
          name="Personal Space"
          description="Private content visible only to you."
          applies={false}
        />
        <ScopeCard
          icon={UsersThree}
          name="Shared With Me"
          description="Items others have shared directly with you."
          applies={false}
        />
        <ScopeCard
          icon={Buildings}
          name="Organization"
          description="Content created in the org's shared space."
          applies
        />
      </div>
    </div>
  );
}

export function PermissionDefaultsSection() {
  const { defaults, loading, error, refresh, update, dismissError } = usePermissionDefaults();

  useEffect(() => {
    refresh();
  }, [refresh]);

  const defaultsByType = new Map(defaults.map((d) => [d.contentType, d]));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck size={24} weight="duotone" className="text-primary shrink-0" />
          <h1 className="text-xl md:text-2xl font-bold">Permission Defaults</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Default access mode for new content created in this organization.
          <span className="hidden sm:inline"> These can be overridden per item.</span>
        </p>
      </div>

      <ScopeOverview />

      {error && (
        <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-red-800 dark:text-red-400">
              <WarningCircle size={20} weight="fill" />
              {error}
            </div>
            <button
              type="button"
              onClick={dismissError}
              className="text-sm text-red-800 dark:text-red-400 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading permission defaults...</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {ALL_CONTENT_TYPES.map((ct) => (
            <ContentTypeCard
              key={ct}
              contentType={ct}
              defaults={defaultsByType.get(ct)}
              onUpdate={update}
            />
          ))}
        </div>
      )}
    </div>
  );
}
