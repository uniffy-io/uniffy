import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CircleNotch } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/shared/utils/cn";
import { formatCurrency } from "@/shared/utils/currencyFormatting";
import { formatProtoDate } from "@/shared/utils/dateFormatting";
import {
  selectSkillMetricsEntry,
  type SkillMetricsEntry,
} from "@/features/agents/store/agentSkillMetricsSlice";
import {
  SKILL_METRICS_DEFAULT_WINDOW_DAYS,
  fetchSkillMetrics,
  skillMetricRowKey,
  type SerializedSkillMetric,
} from "@/features/agents/store/agentSkillMetricsThunks";
import {
  NO_VALUE,
  formatAverageDuration,
  formatCompactCount,
  formatCount,
  formatDurationMs,
  formatRunLogCoverage,
  formatShare,
  invocationOutcomes,
  runLogCoverage,
  sortBySkillThenVersionDesc,
  sortByVersionDesc,
} from "@/features/agents/utils/skillMetricsFormat";

type WindowChoice = "7" | "30" | "90";

const WINDOW_OPTIONS: { value: WindowChoice; content: string; title: string }[] = [
  { value: "7", content: "7d", title: "Last 7 days" },
  { value: "30", content: "30d", title: "Last 30 days" },
  { value: "90", content: "90d", title: "Last 90 days" },
];

const FOOTNOTE =
  "Completed means the run finished, not that the answer was right. Duration, tokens and cost " +
  "cover only invocations with a correlated run log, so a thin coverage figure is not low usage.";

interface SkillMetricsPanelProps {
  /** Omit for org-wide reporting, which needs an org admin; a skill filter is open to builders. */
  skillId?: string;
  tone?: "surface" | "card";
  testId?: string;
}

/** Operational observations do not establish answer quality or causation. */
export function SkillMetricsPanel({ skillId = "", tone = "card", testId }: SkillMetricsPanelProps) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const [windowChoice, setWindowChoice] = useState<WindowChoice>(
    String(SKILL_METRICS_DEFAULT_WINDOW_DAYS) as WindowChoice,
  );
  const windowDays = Number(windowChoice);
  const entry = useAppSelector(selectSkillMetricsEntry({ skillId, windowDays }));

  useEffect(() => {
    if (!organizationId) return;
    dispatch(fetchSkillMetrics({ organizationId, skillId, windowDays, cursor: "" }));
  }, [dispatch, organizationId, skillId, windowDays]);

  const retry = useCallback(() => {
    if (!organizationId) return;
    dispatch(fetchSkillMetrics({ organizationId, skillId, windowDays, cursor: "" }));
  }, [dispatch, organizationId, skillId, windowDays]);

  const nextCursor = entry?.nextCursor ?? "";
  const loadMore = useCallback(() => {
    if (!organizationId || !nextCursor) return;
    dispatch(fetchSkillMetrics({ organizationId, skillId, windowDays, cursor: nextCursor }));
  }, [dispatch, organizationId, skillId, windowDays, nextCursor]);

  const showSkill = !skillId;
  const rows = useMemo(
    () =>
      entry
        ? showSkill
          ? sortBySkillThenVersionDesc(entry.rows)
          : sortByVersionDesc(entry.rows)
        : [],
    [entry, showSkill],
  );

  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="skill-metrics-window">
          {windowCaption(entry, windowDays)}
        </p>
        <SegmentedControl
          value={windowChoice}
          onChange={setWindowChoice}
          options={WINDOW_OPTIONS.map((option) => ({
            ...option,
            content: <span className="px-1.5 text-xs font-medium">{option.content}</span>,
          }))}
          ariaLabel="Observation window"
        />
      </div>

      <SkillMetricsTable
        entry={entry}
        rows={rows}
        showSkill={showSkill}
        tone={tone}
        onRetry={retry}
      />

      {entry?.nextCursor && (
        <Button
          variant="ghost"
          size="sm"
          disabled={entry.status === "loading-more"}
          onClick={loadMore}
          data-testid="skill-metrics-load-more"
        >
          {entry.status === "loading-more" ? "Loading..." : "Load more versions"}
        </Button>
      )}

      <p className="text-xs text-muted-foreground">{FOOTNOTE}</p>
    </div>
  );
}

function windowCaption(entry: SkillMetricsEntry | undefined, windowDays: number): string {
  const base = `Last ${windowDays} days`;
  if (!entry?.windowStart || !entry.windowEnd) return base;
  return `${base}: ${formatProtoDate(entry.windowStart)} to ${formatProtoDate(entry.windowEnd)}`;
}

function SkillMetricsTable({
  entry,
  rows,
  showSkill,
  tone,
  onRetry,
}: {
  entry: SkillMetricsEntry | undefined;
  rows: SerializedSkillMetric[];
  showSkill: boolean;
  tone: "surface" | "card";
  onRetry: () => void;
}) {
  const columnCount = 9;
  const initialLoad = !entry || (entry.status === "loading" && entry.rows.length === 0);
  const refreshing = entry?.status === "loading" && entry.rows.length > 0;

  return (
    <Card
      tone={tone}
      className="max-h-[60dvh] overflow-auto focus-ring [--sticky-top:0px]"
      role="region"
      aria-label="Skill invocation observations"
      tabIndex={0}
    >
      <Table tone={tone} rounded={false}>
        <TableHeader>
          <TableRow hoverable={false}>
            <TableHead>
              <span className="inline-flex items-center gap-2">
                {showSkill ? "Skill version" : "Version"}
                {refreshing && (
                  <CircleNotch size={12} className="animate-spin normal-case tracking-normal" />
                )}
              </span>
            </TableHead>
            <TableHead align="right">Invocations</TableHead>
            <TableHead align="right">Completed</TableHead>
            <TableHead align="right">Tool errors</TableHead>
            <TableHead align="right" className="hidden md:table-cell">
              Users
            </TableHead>
            <TableHead align="right" className="hidden md:table-cell">
              Run logs
            </TableHead>
            <TableHead align="right" className="hidden lg:table-cell">
              Duration
            </TableHead>
            <TableHead align="right" className="hidden lg:table-cell">
              Tokens
            </TableHead>
            <TableHead align="right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {initialLoad && entry?.status !== "failed" ? (
            <TableLoading colSpan={columnCount} message="Loading observations..." />
          ) : entry?.status === "failed" && entry.rows.length === 0 ? (
            <TableEmpty
              colSpan={columnCount}
              title="Observations could not be loaded."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                  data-testid="skill-metrics-retry"
                >
                  Try again
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <TableEmpty
              colSpan={columnCount}
              title="No invocations in this window."
              description={
                showSkill
                  ? "A row appears once an agent runs a skill version."
                  : "A row appears once an agent runs a version of this skill."
              }
            />
          ) : (
            rows.map((row) => (
              <MetricRow key={skillMetricRowKey(row)} row={row} showSkill={showSkill} />
            ))
          )}
          {entry?.status === "failed" && entry.rows.length > 0 && (
            <TableRow hoverable={false}>
              <TableCell
                colSpan={columnCount}
                className="py-3 text-center text-xs text-muted-foreground"
              >
                More observations could not be loaded.{" "}
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-primary hover:underline"
                  data-testid="skill-metrics-retry"
                >
                  Try again
                </button>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

function MetricRow({ row, showSkill }: { row: SerializedSkillMetric; showSkill: boolean }) {
  const coverage = runLogCoverage(row);
  const outcomes = invocationOutcomes(row).filter((outcome) => outcome.count > 0);
  const derivedTitle =
    coverage === "none"
      ? "No invocation in this window has a correlated run log"
      : coverage === "partial"
        ? `Covers ${formatRunLogCoverage(row)} invocations`
        : undefined;

  return (
    <TableRow
      data-testid="skill-metrics-row"
      data-skill-id={row.skillId}
      data-version-id={row.skillVersionId}
    >
      <TableCell>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {showSkill ? (
            <Link
              to={`/agents/skills/${row.skillId}`}
              className="font-medium text-foreground hover:underline"
            >
              {row.displayName}
            </Link>
          ) : null}
          <span
            className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
            title={`Version ${row.skillVersionNumber}`}
          >
            v{row.skillVersionNumber}
          </span>
        </div>
        <p
          className="mt-0.5 font-mono text-[11px] text-subtle-foreground"
          title={row.skillVersionId}
        >
          {row.skillVersionId}
        </p>
      </TableCell>
      <TableCell align="right" className="tabular-nums">
        <span className="font-medium text-foreground">{formatCount(row.invocationCount)}</span>
        {outcomes.length > 0 && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {outcomes
              .map((outcome) => `${formatCount(outcome.count)} ${outcome.label}`)
              .join(" · ")}
          </p>
        )}
      </TableCell>
      <TableCell align="right" className="tabular-nums">
        <RateCell count={row.completedCount} whole={row.invocationCount} />
      </TableCell>
      <TableCell align="right" className="tabular-nums">
        <RateCell
          count={row.toolErrorRunCount}
          whole={row.invocationCount}
          tone={row.toolErrorRunCount > 0 ? "warn" : undefined}
        />
      </TableCell>
      <TableCell align="right" className="tabular-nums hidden md:table-cell">
        {formatCount(row.uniqueUsers)}
      </TableCell>
      <TableCell align="right" className="tabular-nums hidden md:table-cell">
        <span className={cn(coverage === "none" && "text-muted-foreground")}>
          {formatRunLogCoverage(row)}
        </span>
        {coverage === "partial" && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">partial coverage</p>
        )}
      </TableCell>
      <TableCell align="right" className="tabular-nums hidden lg:table-cell" title={derivedTitle}>
        {coverage === "none" ? (
          <span className="text-muted-foreground">{NO_VALUE}</span>
        ) : (
          <>
            {formatDurationMs(row.durationMs)}
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {formatAverageDuration(row)} per logged run
            </p>
          </>
        )}
      </TableCell>
      <TableCell align="right" className="tabular-nums hidden lg:table-cell" title={derivedTitle}>
        {coverage === "none" ? (
          <span className="text-muted-foreground">{NO_VALUE}</span>
        ) : (
          <>
            <span title={`${formatCount(row.inputTokens)} input tokens`}>
              {formatCompactCount(row.inputTokens)} in
            </span>
            <p
              className="mt-0.5 text-[11px] text-muted-foreground"
              title={`${formatCount(row.outputTokens)} output tokens`}
            >
              {formatCompactCount(row.outputTokens)} out
            </p>
          </>
        )}
      </TableCell>
      <TableCell align="right" className="tabular-nums" title={derivedTitle}>
        <CostCell row={row} coverage={coverage} />
      </TableCell>
    </TableRow>
  );
}

function RateCell({ count, whole, tone }: { count: number; whole: number; tone?: "warn" }) {
  return (
    <>
      <span className={cn(tone === "warn" && "text-amber-600 dark:text-amber-400")}>
        {formatCount(count)}
      </span>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{formatShare(count, whole)}</p>
    </>
  );
}

/** One line per currency; totals never merge across currencies. */
function CostCell({
  row,
  coverage,
}: {
  row: SerializedSkillMetric;
  coverage: ReturnType<typeof runLogCoverage>;
}) {
  if (coverage === "none") return <span className="text-muted-foreground">{NO_VALUE}</span>;
  if (row.costs.length === 0) {
    return <span className="text-muted-foreground">No priced runs</span>;
  }
  return (
    <div className="space-y-0.5">
      {row.costs.map((cost) => (
        <p key={cost.currency}>
          {formatCurrency(cost.amount, cost.currency)}
          <span className="ml-1 text-[11px] text-muted-foreground">
            {formatCount(cost.runCount)} {cost.runCount === 1 ? "run" : "runs"}
          </span>
        </p>
      ))}
    </div>
  );
}
