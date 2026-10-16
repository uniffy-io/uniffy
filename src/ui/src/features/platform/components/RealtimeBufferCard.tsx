import { Pulse } from "@phosphor-icons/react";
import {
  RealtimeBufferVerdict,
  type RealtimeBufferStatus,
} from "@uniffy/proto/superadmin/v1/system_config_pb";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatFileSize } from "@/shared/utils/dateFormatting";
import { cn } from "@/shared/utils/cn";

type Tone = "ok" | "warn" | "bad" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  warn: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  bad: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  muted: "bg-muted text-muted-foreground",
};

interface VerdictCopy {
  label: string;
  tone: Tone;
  hint: (status: RealtimeBufferStatus) => string;
}

const NOT_CHECKED: VerdictCopy = {
  label: "Not checked",
  tone: "muted",
  hint: () => "This backend has not reached Valkey yet. Edits are refused until it does.",
};

const VERDICT_COPY: Partial<Record<RealtimeBufferVerdict, VerdictCopy>> = {
  [RealtimeBufferVerdict.ENABLED]: {
    label: "Accepting edits",
    tone: "ok",
    hint: (status) =>
      status.preflightMode === "warn"
        ? "Warn mode logs an allkeys-* eviction policy instead of refusing edits."
        : "The eviction policy keeps pending edits until their checkpoint.",
  },
  [RealtimeBufferVerdict.DISABLED]: {
    label: "Refusing edits",
    tone: "bad",
    hint: (status) =>
      `maxmemory-policy ${status.preflight?.evictionPolicy ?? ""} can evict pending edits. ` +
      "Set noeviction or volatile-*, or REALTIME_VALKEY_PREFLIGHT=warn to accept that risk. " +
      "Editors keep their changes on their devices meanwhile.",
  },
  [RealtimeBufferVerdict.UNKNOWN]: {
    label: "Policy unknown",
    tone: "warn",
    hint: () =>
      "CONFIG is renamed or denied, so edits are accepted unchecked. " +
      "Confirm maxmemory-policy is noeviction or volatile-*.",
  },
};

/** "<1s", "42s", "3m 20s", "2h 5m" */
function formatAge(seconds: number): string {
  if (seconds < 1) return "<1s";
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m ${whole % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function sumCounts(counts: Record<string, bigint>): number {
  return Object.values(counts).reduce((total, count) => total + Number(count), 0);
}

/** "gap: 1, identity_changed: 2" for a tooltip; nothing when no reason has counted yet. */
function describeCounts(counts: Record<string, bigint>): string | undefined {
  const parts = Object.entries(counts).map(([reason, count]) => `${reason}: ${count}`);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function maxmemoryLabel(bytes: bigint | undefined): string {
  if (bytes === undefined) return "Unreadable";
  return bytes === 0n ? "Unlimited" : formatFileSize(Number(bytes));
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold text-foreground truncate">{value}</div>
    </div>
  );
}

function Fact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground break-words" title={title}>
        {value}
      </dd>
    </div>
  );
}

function Readings({ status }: { status: RealtimeBufferStatus }) {
  const { preflight, totals } = status;
  return (
    <>
      {totals ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat
            label="Pending"
            value={
              preflight
                ? `${formatFileSize(Number(totals.pendingBytes))} of ${formatFileSize(
                    Number(preflight.pendingBudgetBytes),
                  )}`
                : formatFileSize(Number(totals.pendingBytes))
            }
          />
          <Stat label="Records" value={String(totals.pendingRecords)} />
          <Stat label="Documents" value={String(totals.pendingDocuments)} />
          <Stat
            label="Oldest edit"
            value={totals.pendingDocuments > 0n ? formatAge(totals.oldestPendingSeconds) : "None"}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Valkey could not be read for this refresh, so pending totals are unavailable.
        </p>
      )}

      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 pt-3 border-t border-border/60">
        {preflight && (
          <>
            <Fact label="Eviction policy" value={preflight.evictionPolicy ?? "Unreadable"} />
            <Fact label="Max memory" value={maxmemoryLabel(preflight.maxmemoryBytes)} />
            <Fact label="Persistence" value={preflight.lossWindow} />
            <Fact
              label="Valkey"
              value={`${preflight.valkeyVersion}, run ${preflight.valkeyRunIdPrefix}`}
            />
            <Fact
              label="Pending budget"
              value={`${formatFileSize(Number(preflight.pendingBudgetBytes))}, ${
                status.pendingBudgetFromEnv
                  ? "set by REALTIME_PENDING_BUDGET_BYTES"
                  : "from maxmemory"
              }`}
            />
          </>
        )}
        <Fact label="Preflight mode" value={status.preflightMode} />
        <Fact
          label="Epoch resets since this backend started"
          value={String(sumCounts(status.epochResets))}
          title={describeCounts(status.epochResets)}
        />
        <Fact
          label="Poisoned checkpoints since this backend started"
          value={String(sumCounts(status.poisonedCheckpoints))}
          title={describeCounts(status.poisonedCheckpoints)}
        />
      </dl>
    </>
  );
}

interface RealtimeBufferCardProps {
  status: RealtimeBufferStatus | null;
  /** The latest refresh failed; `status` is the reading before it. */
  stale: boolean;
  pollSeconds: number;
}

/** Read-only operator view of the Valkey buffer that holds edits until their checkpoint. */
export function RealtimeBufferCard({ status, stale, pollSeconds }: RealtimeBufferCardProps) {
  const copy = (status && VERDICT_COPY[status.verdict]) ?? NOT_CHECKED;
  return (
    <Card tone="surface" className="p-4 space-y-4">
      <div className="flex items-start gap-2">
        <Pulse
          size={20}
          weight="duotone"
          className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground">Realtime edit buffer</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Accepted edits wait in Valkey until their PostgreSQL checkpoint. Deployment totals only,
            no tenant detail.
          </p>
        </div>
        {status && (
          <Badge className={cn("border-transparent shrink-0", TONE_CLASS[copy.tone])}>
            {copy.label}
          </Badge>
        )}
      </div>

      {status ? (
        <>
          <p className="text-xs text-muted-foreground">{copy.hint(status)}</p>
          <Readings status={status} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {stale ? "The buffer status could not be read." : "Loading..."}
        </p>
      )}

      <p className="text-[11px] text-subtle-foreground">
        {stale && status
          ? "The last refresh failed. Showing the reading before it."
          : `Refreshes every ${pollSeconds} seconds.`}
      </p>
    </Card>
  );
}
