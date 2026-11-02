import { Link } from "react-router-dom";
import { ArrowCounterClockwise, Check, SquaresFour, X } from "@phosphor-icons/react";
import { useState } from "react";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { DashboardNameField } from "@/features/dashboard/components/DashboardNameField";
import { useDashboardProposal } from "@/features/dashboard/hooks/useDashboardProposal";
import { describeFilters, type DashboardProposal } from "@/features/dashboard/utils/layout";

/** Preview of a layout an agent drafted; nothing changes until the viewer applies it. */
export function DashboardProposalCard({ proposal }: { proposal: DashboardProposal }) {
  const { catalog, saving, state, sameOrganization, apply, undo, discard } =
    useDashboardProposal(proposal);
  const projects = useAppSelector((s) => s.projects.projects);
  const [draftName, setDraftName] = useState(proposal.definition.name);
  const labels = new Map(catalog?.widgets.map((widget) => [widget.id, widget.label]) ?? []);

  if (state === "discarded") {
    return (
      <p className="mt-2 text-xs text-subtle-foreground" data-testid="dashboard-proposal-discarded">
        Dashboard draft discarded. Your layout is unchanged.
      </p>
    );
  }

  return (
    <div
      className="mt-2 max-w-md rounded-xl bg-card p-3 shadow-edge"
      data-testid="dashboard-proposal-card"
    >
      <div className="flex items-start gap-2.5">
        <div className="rounded-lg bg-primary/10 p-1.5 text-primary">
          <SquaresFour size={16} weight="duotone" />
        </div>
        <div className="min-w-0 flex-1">
          {state === "applied" ? (
            <p className="truncate text-sm font-medium">{draftName || "Dashboard draft"}</p>
          ) : (
            <DashboardNameField
              value={draftName}
              onSave={setDraftName}
              emptyLabel="Name this dashboard"
              className="text-sm font-medium"
              testId="dashboard-proposal-name"
            />
          )}
          <p className="text-xs text-subtle-foreground">
            {proposal.definition.widgets.length} widgets, in this order
          </p>
        </div>
      </div>

      <ol className="mt-3 space-y-1">
        {proposal.definition.widgets.map((widget, index) => {
          const names = widget.filters.projectIds
            .map((id) => projects[id]?.name)
            .filter((name): name is string => Boolean(name));
          const summary = describeFilters(widget.filters, names);
          return (
            <li key={widget.id} className="flex items-baseline gap-2 text-xs">
              <span className="w-4 shrink-0 text-right tabular-nums text-subtle-foreground">
                {index + 1}
              </span>
              <span className="font-medium text-foreground">
                {labels.get(widget.id) ?? widget.id}
              </span>
              {summary && <span className="truncate text-muted-foreground">{summary}</span>}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {state === "applied" ? (
          <>
            <span className="flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
              <Check size={12} />
              Applied to your dashboard
            </span>
            <Link to="/" className="text-xs font-medium text-primary hover:text-primary/80">
              Open dashboard
            </Link>
            <Button variant="ghost" size="sm" onClick={() => void undo()} disabled={saving}>
              <ArrowCounterClockwise size={12} />
              Undo
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => void apply(draftName)}
              loading={saving}
              disabled={!sameOrganization}
              data-testid="dashboard-proposal-apply"
            >
              <Check size={12} />
              Apply to my dashboard
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={discard}
              data-testid="dashboard-proposal-discard"
            >
              <X size={12} />
              Discard
            </Button>
            {!sameOrganization && (
              <span className="text-xs text-subtle-foreground">
                Drafted for another organization.
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
