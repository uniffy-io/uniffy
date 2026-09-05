import { useMemo, useState } from "react";
import { ArrowCounterClockwise, CircleNotch, PushPin } from "@phosphor-icons/react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/shared/utils/cn";
import { formatProtoDateTime } from "@/shared/utils/dateFormatting";
import { diffStat } from "@/features/agents/utils/instructionDiff";
import { InstructionVersionDiff } from "@/features/agents/components/instruction/InstructionVersionDiff";

export interface InstructionVersion {
  id: string;
  versionNumber: number;
  content: string;
  changeSummary: string;
  authorKind?: string;
  createdAt?: { seconds: number; nanos: number };
}

interface InstructionVersionHistoryProps {
  /** Newest first. */
  versions: InstructionVersion[];
  activeVersionNumber: number;
  latestVersionNumber: number;
  pinned: boolean;
  loading: boolean;
  canEdit: boolean;
  onFollowLatest: () => Promise<unknown>;
  onSetMain: (versionNumber: number) => Promise<unknown>;
  onRevert: (versionNumber: number) => Promise<unknown>;
  onLoadMore?: () => void;
  testId?: string;
}

/**
 * Version list shared by skills and rules: a compare pair, the row per version
 * with its line delta, and the main/revert actions.
 */
export function InstructionVersionHistory({
  versions,
  activeVersionNumber,
  latestVersionNumber,
  pinned,
  loading,
  canEdit,
  onFollowLatest,
  onSetMain,
  onRevert,
  onLoadMore,
  testId,
}: InstructionVersionHistoryProps) {
  const [busy, setBusy] = useState<number | "follow" | null>(null);
  // Null until the user picks a pair of their own; "main vs latest" applies until then.
  const [compareOverride, setCompareOverride] = useState<{ base: number; target: number } | null>(
    null,
  );

  const compare = useMemo(() => {
    if (compareOverride) return compareOverride;
    if (versions.length < 2) return null;
    const base =
      activeVersionNumber && activeVersionNumber !== latestVersionNumber
        ? activeVersionNumber
        : versions[1].versionNumber;
    return { base, target: latestVersionNumber };
  }, [compareOverride, versions, activeVersionNumber, latestVersionNumber]);

  const byNumber = useMemo(() => {
    const map = new Map<number, InstructionVersion>();
    for (const v of versions) map.set(v.versionNumber, v);
    return map;
  }, [versions]);

  const run = async (key: number | "follow", action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const baseVersion = compare ? byNumber.get(compare.base) : undefined;
  const targetVersion = compare ? byNumber.get(compare.target) : undefined;
  const versionOptions = versions.map((v) => ({
    value: v.versionNumber,
    label: `v${v.versionNumber}`,
  }));

  return (
    <div className="space-y-3" data-testid={testId}>
      <p className="text-xs text-muted-foreground">
        {pinned
          ? `Pinned to version ${activeVersionNumber}`
          : "Following the latest edit automatically"}
      </p>

      {canEdit && pinned && (
        <Checkbox
          label="Use the latest version automatically"
          checked={false}
          disabled={busy !== null}
          onChange={() => run("follow", onFollowLatest)}
        />
      )}

      {compare && baseVersion && targetVersion && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Compare</span>
            <Select
              value={compare.base}
              onChange={(value) => setCompareOverride({ ...compare, base: value })}
              size="sm"
              triggerClassName="min-w-0 w-20"
              options={versionOptions}
            />
            <span>with</span>
            <Select
              value={compare.target}
              onChange={(value) => setCompareOverride({ ...compare, target: value })}
              size="sm"
              triggerClassName="min-w-0 w-20"
              options={versionOptions}
            />
          </div>
          <div className="max-h-64 overflow-hidden flex flex-col">
            <InstructionVersionDiff
              oldText={baseVersion.content}
              newText={targetVersion.content}
              oldLabel={`v${baseVersion.versionNumber}`}
              newLabel={`v${targetVersion.versionNumber}`}
            />
          </div>
        </div>
      )}

      {loading && versions.length === 0 && (
        <div className="flex items-center justify-center py-6">
          <CircleNotch size={20} className="animate-spin text-muted-foreground" />
        </div>
      )}
      {!loading && versions.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">No version history yet.</p>
      )}

      <div className="space-y-2">
        {versions.map((version, i) => {
          const prev = versions[i + 1];
          const stat = prev ? diffStat(prev.content, version.content) : null;
          const isMain = version.versionNumber === activeVersionNumber;
          const rowBusy = busy === version.versionNumber;
          return (
            <div
              key={version.id}
              className={cn(
                "rounded-xl px-3 py-2.5",
                isMain ? "bg-primary/5 shadow-edge-primary" : "bg-card shadow-edge",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  v{version.versionNumber}
                </span>
                {isMain && (
                  <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary rounded px-1.5 py-0.5">
                    {pinned && <PushPin size={11} weight="fill" />}
                    Main
                  </span>
                )}
                {version.authorKind && (
                  <span className="text-xs text-muted-foreground">
                    {version.authorKind === "agent" ? "Agent" : "User"}
                  </span>
                )}
                {stat && (stat.added > 0 || stat.removed > 0) && (
                  <span className="text-xs font-mono">
                    <span className="text-green-600 dark:text-green-400">+{stat.added}</span>{" "}
                    <span className="text-red-500">-{stat.removed}</span>
                  </span>
                )}
                {version.createdAt && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatProtoDateTime(version.createdAt)}
                  </span>
                )}
              </div>
              {version.changeSummary && (
                <p className="text-xs text-muted-foreground mt-1">{version.changeSummary}</p>
              )}
              {canEdit && (
                <div className="flex items-center gap-3 mt-2">
                  {!isMain && (
                    <button
                      type="button"
                      onClick={() =>
                        run(version.versionNumber, () => onSetMain(version.versionNumber))
                      }
                      disabled={busy !== null}
                      className="text-xs text-primary hover:underline disabled:opacity-50"
                    >
                      {rowBusy ? "Working..." : "Set as main"}
                    </button>
                  )}
                  {version.versionNumber !== latestVersionNumber && (
                    <button
                      type="button"
                      onClick={() =>
                        run(version.versionNumber, () => onRevert(version.versionNumber))
                      }
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <ArrowCounterClockwise size={12} />
                      Revert to this
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {onLoadMore && (
        <Button variant="ghost" size="sm" disabled={loading} onClick={onLoadMore}>
          Load older versions
        </Button>
      )}
    </div>
  );
}
