import { useCallback, useEffect, useMemo, useState } from 'react';
import { TreeStructure, Trash, Users, X } from '@phosphor-icons/react';
import { GroupKind } from '@uniffy/proto/common/v1/common_pb';
import { Button } from '@/components/ui/button';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useGroupMembers } from '@/features/admin/hooks/useAdminHooks';
import type { SerializedGroupInfo } from '@/features/admin/store/adminSlice';
import { SubjectAvatarById } from '@/components/subject/SubjectAvatar';
import {
    SubjectSearchInput,
    SubjectSearchResults,
} from '@/components/subject/SubjectSearch';
import { useSubjectSearch } from '@/components/subject/hooks/useSubjectSearch';
import type { Subject } from '@/components/subject/types';
import {
    fetchOrgChartThunk,
    setManagerThunk,
} from '@/features/people/store/peopleThunks';

interface GroupMembersModalProps {
    group: SerializedGroupInfo;
    onClose: () => void;
}

export function GroupMembersModal({ group, onClose }: GroupMembersModalProps) {
    const dispatch = useAppDispatch();
    const { members, loading, add, remove, refresh } = useGroupMembers(group.id);
    const [removing, setRemoving] = useState<string | null>(null);
    const [addingId, setAddingId] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [editingManagerFor, setEditingManagerFor] = useState<string | null>(null);
    const [savingManagerFor, setSavingManagerFor] = useState<string | null>(null);
    const [managerQuery, setManagerQuery] = useState('');

    const isTeam = group.kind === GroupKind.TEAM;
    const chart = useAppSelector((s) => s.people.chart);
    const [chartLoaded, setChartLoaded] = useState(false);
    // Reporting lines are an org-chart surface; when the org turned that off,
    // manager edits stay in the members admin page.
    const showManagers = isTeam && chartLoaded && chart.enabled;

    // One cached RPC carries every member's manager edge and display name.
    useEffect(() => {
        if (!isTeam) return;
        let cancelled = false;
        void dispatch(fetchOrgChartThunk()).then((action) => {
            if (!cancelled && fetchOrgChartThunk.fulfilled.match(action)) setChartLoaded(true);
        });
        return () => {
            cancelled = true;
        };
    }, [dispatch, isTeam]);

    const chartById = useMemo(
        () => new Map(chart.nodes.map((node) => [node.userId, node])),
        [chart.nodes]
    );

    const applyManager = useCallback(
        async (userId: string, managerUserId: string | null) => {
            setSavingManagerFor(userId);
            const action = await dispatch(setManagerThunk({ userId, managerUserId }));
            setSavingManagerFor(null);
            if (setManagerThunk.fulfilled.match(action)) {
                setEditingManagerFor(null);
                setManagerQuery('');
            }
        },
        [dispatch]
    );

    const toggleManagerEditor = useCallback((userId: string) => {
        setManagerQuery('');
        setEditingManagerFor((current) => (current === userId ? null : userId));
    }, []);

    const excludeIds = useMemo(() => members.map((m) => m.userId), [members]);
    const { results, loading: searching, search } = useSubjectSearch({
        subjectTypes: 'users',
        excludeIds,
    });

    const {
        results: managerResults,
        loading: searchingManagers,
        search: searchManagers,
    } = useSubjectSearch({
        subjectTypes: 'users',
        excludeIds: editingManagerFor ? [editingManagerFor] : [],
    });

    useEffect(() => {
        search(query);
    }, [query, search]);

    useEffect(() => {
        searchManagers(managerQuery);
    }, [managerQuery, searchManagers]);

    // One list area: typing turns it into add-results, clearing shows the roster.
    const showResults = query.trim().length >= 2;

    const handleRemove = async (userId: string) => {
        setRemoving(userId);
        try {
            await remove(userId);
        } finally {
            setRemoving(null);
        }
    };

    // The query survives an add so several people can be added from one
    // search; the added person drops out of the results via excludeIds.
    const handleAdd = async (subject: Subject) => {
        setAddingId(subject.id);
        try {
            await add(subject.id);
            refresh();
        } finally {
            setAddingId(null);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
            <div className="w-full sm:w-[calc(100vw-2rem)] sm:max-w-lg bg-card rounded-t-xl sm:rounded-xl border border-border shadow-xl">
                <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-border">
                    <div>
                        <h2 className="text-lg font-semibold">{group.name}</h2>
                        <p className="text-sm text-muted-foreground">
                            {members.length} member{members.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        <X size={20} weight="bold" />
                    </button>
                </div>

                <div className="px-4 md:px-6 pt-4">
                    <SubjectSearchInput
                        value={query}
                        onChange={setQuery}
                        placeholder="Add people by name or email..."
                    />
                </div>

                <div className="p-4 md:p-6 h-[50vh] md:h-96 overflow-y-auto">
                    {showResults ? (
                        <SubjectSearchResults
                            results={results}
                            loading={searching}
                            query={query}
                            busyId={addingId}
                            onSelect={handleAdd}
                        />
                    ) : loading ? (
                        <div className="py-8 text-center">
                            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">Loading members...</p>
                        </div>
                    ) : members.length === 0 ? (
                        <div className="py-8 text-center">
                            <Users size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-2" />
                            <p className="text-sm text-muted-foreground">No members yet</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Search above to add people.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {members.map((member) => {
                                const managerId =
                                    chartById.get(member.userId)?.managerUserId ?? null;
                                const managerName = managerId
                                    ? chartById.get(managerId)?.displayName ?? 'someone'
                                    : null;
                                const leadName =
                                    group.leadUserId &&
                                    group.leadUserId !== member.userId &&
                                    group.leadUserId !== managerId
                                        ? chartById.get(group.leadUserId)?.displayName ?? null
                                        : null;
                                const editing = editingManagerFor === member.userId;
                                const saving = savingManagerFor === member.userId;

                                return (
                                    <div
                                        key={member.userId}
                                        className="rounded-lg hover:bg-muted/50 group"
                                    >
                                        <div className="flex items-center gap-3 py-2 px-3">
                                            <SubjectAvatarById
                                                userId={member.userId}
                                                displayName={member.displayName}
                                                size="md"
                                            />

                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{member.displayName}</p>
                                                <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                                            </div>

                                            {showManagers && (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleManagerEditor(member.userId)}
                                                    disabled={saving}
                                                    className="flex max-w-[9rem] shrink-0 items-center gap-1.5 rounded-md
                                                        border border-border px-2 py-1 text-xs text-muted-foreground
                                                        transition-colors hover:border-primary/40 hover:text-primary
                                                        disabled:opacity-50"
                                                    title="Set who this person reports to"
                                                >
                                                    <TreeStructure size={14} className="shrink-0" />
                                                    <span className="truncate">
                                                        {managerName
                                                            ? `Reports to ${managerName}`
                                                            : 'Set manager'}
                                                    </span>
                                                </button>
                                            )}

                                            <button
                                                type="button"
                                                onClick={() => handleRemove(member.userId)}
                                                disabled={removing === member.userId}
                                                className="p-1.5 rounded-md text-muted-foreground hover:text-red-500
                                                    hover:bg-red-500/10 md:opacity-0 md:group-hover:opacity-100 transition-all
                                                    disabled:opacity-50"
                                                title="Remove from group"
                                            >
                                                <Trash size={16} />
                                            </button>
                                        </div>

                                        {showManagers && editing && (
                                            <div className="space-y-2 border-t border-border/60 px-3 py-2.5">
                                                {leadName && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={saving}
                                                        onClick={() =>
                                                            applyManager(
                                                                member.userId,
                                                                group.leadUserId
                                                            )
                                                        }
                                                    >
                                                        Report to {leadName} (team lead)
                                                    </Button>
                                                )}
                                                <SubjectSearchInput
                                                    value={managerQuery}
                                                    onChange={setManagerQuery}
                                                    placeholder="Search for a manager..."
                                                    disabled={saving}
                                                />
                                                {managerQuery.trim().length >= 2 && (
                                                    <SubjectSearchResults
                                                        results={managerResults}
                                                        loading={searchingManagers}
                                                        query={managerQuery}
                                                        actionLabel="Select"
                                                        busyId={saving ? member.userId : null}
                                                        onSelect={(subject) =>
                                                            applyManager(member.userId, subject.id)
                                                        }
                                                        className="max-h-44 overflow-y-auto rounded-md border border-border p-1"
                                                    />
                                                )}
                                                {managerId && (
                                                    <button
                                                        type="button"
                                                        disabled={saving}
                                                        onClick={() =>
                                                            applyManager(member.userId, null)
                                                        }
                                                        className="text-xs text-muted-foreground hover:text-red-500
                                                            disabled:opacity-50"
                                                    >
                                                        Clear manager
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex justify-end px-4 md:px-6 py-3 md:py-4 border-t border-border">
                    <Button size="md" onClick={onClose}>
                        Done
                    </Button>
                </div>
            </div>
        </div>
    );
}
