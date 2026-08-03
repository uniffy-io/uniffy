import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TreeStructure, UsersThree } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { WidgetCard, EmptyWidget } from '@/features/dashboard/components/widgets/WidgetCard';
import { SubjectAvatarById, SubjectAvatarStack, useSubjectResolver } from '@/components/subject';
import {
    fetchPersonThunk,
    fetchProfilePolicyThunk,
    fetchTeamThunk,
} from '@/features/people/store/peopleThunks';

export function PeopleWidget() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const { isMobile } = useBreakpoint();

    const userId = useAppSelector((s) => s.auth.user?.id ?? '');
    const person = useAppSelector((s) => (userId ? s.people.profilesById[userId] : undefined));
    const profilesById = useAppSelector((s) => s.people.profilesById);
    const policy = useAppSelector((s) => s.people.policy);
    const memberIdsByTeam = useAppSelector((s) => s.people.teams.memberIdsByTeam);

    const firstTeam = person?.teams[0];

    useEffect(() => {
        if (userId) dispatch(fetchPersonThunk({ userId }));
    }, [dispatch, userId]);

    useEffect(() => {
        if (policy.status === 'idle') dispatch(fetchProfilePolicyThunk());
    }, [dispatch, policy.status]);

    useEffect(() => {
        if (firstTeam && !memberIdsByTeam[firstTeam.groupId]) {
            dispatch(fetchTeamThunk({ groupId: firstTeam.groupId }));
        }
    }, [dispatch, firstTeam, memberIdsByTeam]);

    const managerId = person?.managerUserId ?? null;
    const { subjects: managerSubjects } = useSubjectResolver(managerId ? [managerId] : []);
    const managerSubject = managerSubjects[0];
    const managerProfile = managerId ? profilesById[managerId] : undefined;

    const teamMemberIds = useMemo(
        () => (firstTeam ? (memberIdsByTeam[firstTeam.groupId] ?? []) : []),
        [firstTeam, memberIdsByTeam]
    );

    if (isMobile) return null;
    if (policy.status === 'succeeded' && !policy.orgChartEnabled) return null;

    const hasStructure = Boolean(
        managerId || firstTeam || (person && person.directReportCount > 0)
    );

    return (
        <WidgetCard
            title="People"
            icon={UsersThree}
            colSpan={1}
            compact
            priority={2}
            footer={
                <Link
                    to="/people"
                    className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
                >
                    Open the org chart
                </Link>
            }
        >
            {!hasStructure ? (
                <EmptyWidget
                    icon={TreeStructure}
                    title="No org structure yet"
                    description="Your manager and team appear here once they are set"
                    action={{ label: 'Open the org chart', onClick: () => navigate('/people') }}
                />
            ) : (
                <div className="space-y-3">
                    {managerId && (
                        <Link
                            to={`/people/${managerId}`}
                            className="group flex items-center gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-muted/50"
                        >
                            <SubjectAvatarById
                                userId={managerId}
                                displayName={managerSubject?.name}
                                size="md"
                                showPresence
                            />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                                    {managerSubject?.name ?? managerId.slice(-6)}
                                </p>
                                <p className="truncate text-[10px] text-muted-foreground">
                                    {managerProfile?.jobTitle
                                        ? `Manager · ${managerProfile.jobTitle}`
                                        : 'Manager'}
                                </p>
                            </div>
                        </Link>
                    )}

                    {firstTeam && (
                        <Link
                            to={`/people?team=${firstTeam.groupId}`}
                            className="group block rounded-md px-1 py-1 transition-colors hover:bg-muted/50"
                        >
                            <p className="mb-1.5 truncate text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                                {firstTeam.name}
                            </p>
                            {teamMemberIds.length > 0 && (
                                <SubjectAvatarStack
                                    subjectIds={teamMemberIds}
                                    maxDisplay={8}
                                    size="sm"
                                />
                            )}
                        </Link>
                    )}

                    {person && person.directReportCount > 0 && (
                        <Link
                            to="/people"
                            className="block rounded-md px-1 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                        >
                            You have {person.directReportCount} direct report
                            {person.directReportCount === 1 ? '' : 's'}
                        </Link>
                    )}
                </div>
            )}
        </WidgetCard>
    );
}
