import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  CaretRight,
  TreeStructure,
  UserCircle,
  UsersFour,
  UsersThree,
} from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { SubjectAvatarById, useSubjectResolver } from "@/components/subject";
import {
  ProfileEmptyState,
  ProfileSection,
} from "@/features/people/components/profile/ProfileSection";
import type {
  SerializedOrgChartNode,
  SerializedPersonProfile,
} from "@/features/people/store/peopleThunks";

interface ReportingLineProps {
  person: SerializedPersonProfile;
}

function PersonRow({
  userId,
  displayName,
  jobTitle,
  avatarUrl,
}: {
  userId: string;
  displayName: string;
  jobTitle?: string | null;
  avatarUrl?: string | null;
}) {
  return (
    <Link
      to={`/people/${userId}`}
      className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
    >
      <SubjectAvatarById
        userId={userId}
        displayName={displayName}
        avatarUrl={avatarUrl ?? undefined}
        size="md"
        showPresence
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
          {displayName}
        </p>
        {jobTitle && <p className="truncate text-xs text-muted-foreground">{jobTitle}</p>}
      </div>
    </Link>
  );
}

export function ReportingLine({ person }: ReportingLineProps) {
  const chart = useAppSelector((s) => s.people.chart);
  const chartReady = chart.status === "succeeded" && chart.enabled;

  const nodesById = useMemo(() => {
    const map: Record<string, SerializedOrgChartNode> = {};
    for (const node of chart.nodes) {
      map[node.userId] = node;
    }
    return map;
  }, [chart.nodes]);

  const managerChain = useMemo(() => {
    if (!chartReady) return [];
    const chain: SerializedOrgChartNode[] = [];
    const visited = new Set<string>([person.userId]);
    let managerId = person.managerUserId;
    while (managerId && !visited.has(managerId)) {
      const node = nodesById[managerId];
      if (!node) break;
      visited.add(managerId);
      chain.unshift(node);
      managerId = node.managerUserId;
    }
    return chain;
  }, [chartReady, nodesById, person.managerUserId, person.userId]);

  const directReports = useMemo(
    () => (chartReady ? chart.nodes.filter((n) => n.managerUserId === person.userId) : []),
    [chartReady, chart.nodes, person.userId],
  );

  const { subjects: fallbackManagerSubjects } = useSubjectResolver(
    !chartReady && person.managerUserId ? [person.managerUserId] : [],
  );
  const fallbackManager = fallbackManagerSubjects[0];

  const hasAnything =
    person.managerUserId ||
    person.teams.length > 0 ||
    directReports.length > 0 ||
    person.directReportCount > 0;

  if (!hasAnything) {
    return (
      <ProfileEmptyState
        icon={UsersThree}
        title="No org structure yet"
        description="A manager, direct reports, and teams show up here once they are set."
      />
    );
  }

  return (
    <div className="space-y-4">
      {managerChain.length > 1 && (
        <ProfileSection title="Reporting line" icon={TreeStructure}>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            {managerChain.map((node) => (
              <span key={node.userId} className="flex items-center gap-1">
                <Link
                  to={`/people/${node.userId}`}
                  className="rounded px-1 py-0.5 text-foreground/80 transition-colors hover:bg-muted/50 hover:text-primary"
                >
                  {node.displayName}
                </Link>
                <CaretRight size={12} className="text-subtle-foreground" />
              </span>
            ))}
            <span className="px-1 py-0.5 font-medium text-foreground">{person.displayName}</span>
          </div>
        </ProfileSection>
      )}

      {person.managerUserId && (
        <ProfileSection title="Manager" icon={UserCircle}>
          {chartReady && nodesById[person.managerUserId] ? (
            <PersonRow
              userId={person.managerUserId}
              displayName={nodesById[person.managerUserId].displayName}
              jobTitle={nodesById[person.managerUserId].jobTitle}
              avatarUrl={nodesById[person.managerUserId].avatarUrl}
            />
          ) : (
            <PersonRow
              userId={person.managerUserId}
              displayName={fallbackManager?.name ?? person.managerUserId.slice(-6)}
              avatarUrl={fallbackManager?.avatarUrl}
            />
          )}
        </ProfileSection>
      )}

      {(directReports.length > 0 || (!chartReady && person.directReportCount > 0)) && (
        <ProfileSection
          title={
            directReports.length > 0 ? `Direct reports (${directReports.length})` : "Direct reports"
          }
          icon={UsersThree}
        >
          {directReports.length > 0 ? (
            <div className="grid grid-cols-1 gap-1">
              {directReports.map((node) => (
                <PersonRow
                  key={node.userId}
                  userId={node.userId}
                  displayName={node.displayName}
                  jobTitle={node.jobTitle}
                  avatarUrl={node.avatarUrl}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {person.directReportCount} direct report
              {person.directReportCount === 1 ? "" : "s"}
            </p>
          )}
        </ProfileSection>
      )}

      {person.teams.length > 0 && (
        <ProfileSection title="Teams" icon={UsersFour}>
          <div className="flex flex-wrap gap-2">
            {person.teams.map((team) => (
              <Link
                key={team.groupId}
                to={`/people?team=${team.groupId}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                {team.name}
                {team.leadUserId === person.userId && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">
                    Lead
                  </span>
                )}
              </Link>
            ))}
          </div>
        </ProfileSection>
      )}
    </div>
  );
}
