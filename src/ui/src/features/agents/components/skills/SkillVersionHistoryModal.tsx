import { useEffect, useMemo, useState } from 'react';
import { ClockCounterClockwise, PushPin, ArrowCounterClockwise, CircleNotch } from '@phosphor-icons/react';
import { SkillSource } from '@uniffy/proto/agents/v1/skills_pb';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { cn } from '@/shared/utils/cn';
import { formatProtoDateTime } from '@/shared/utils/dateFormatting';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import type { SerializedSkill } from '@/features/agents/store/agentSkillsThunks';
import { selectSkillVersionsEntry } from '@/features/agents/store/agentSkillVersionsSlice';
import {
    fetchSkillVersions,
    setMainSkillVersion,
    revertSkill,
} from '@/features/agents/store/agentSkillVersionsThunks';
import { diffStat } from '@/features/agents/utils/skillDiff';
import { SkillVersionDiff } from '@/features/agents/components/skills/SkillVersionDiff';

interface SkillVersionHistoryModalProps {
    skill: SerializedSkill;
    onClose: () => void;
}

const EMPTY_VERSIONS: never[] = [];

export function SkillVersionHistoryModal({ skill, onClose }: SkillVersionHistoryModalProps) {
    const dispatch = useAppDispatch();
    const entry = useAppSelector(selectSkillVersionsEntry(skill.id));
    const [busy, setBusy] = useState<number | 'follow' | null>(null);
    const [compare, setCompare] = useState<{ base: number; target: number } | null>(null);

    const editable = skill.source !== SkillSource.BUNDLED;

    useEffect(() => {
        dispatch(fetchSkillVersions(skill.id));
    }, [dispatch, skill.id]);

    const versions = useMemo(() => entry?.versions ?? EMPTY_VERSIONS, [entry]);
    const activeNumber = entry?.activeVersionNumber ?? 0;
    const pinned = entry?.activeVersionPinned ?? false;

    // Default the compare picker to "main vs latest" once versions land.
    useEffect(() => {
        if (compare || versions.length < 2 || !entry) return;
        const latest = entry.latestVersionNumber;
        const base = entry.activeVersionNumber && entry.activeVersionNumber !== latest
            ? entry.activeVersionNumber
            : versions[1].versionNumber;
        setCompare({ base, target: latest });
    }, [compare, entry, versions]);

    const byNumber = useMemo(() => {
        const map = new Map<number, (typeof versions)[number]>();
        for (const v of versions) map.set(v.versionNumber, v);
        return map;
    }, [versions]);

    const handleFollowLatest = async () => {
        setBusy('follow');
        try {
            await dispatch(setMainSkillVersion({ skillId: skill.id, followLatest: true })).unwrap();
        } finally {
            setBusy(null);
        }
    };

    const handleSetMain = async (versionNumber: number) => {
        setBusy(versionNumber);
        try {
            await dispatch(
                setMainSkillVersion({ skillId: skill.id, versionNumber, followLatest: false }),
            ).unwrap();
        } finally {
            setBusy(null);
        }
    };

    const handleRevert = async (versionNumber: number) => {
        setBusy(versionNumber);
        try {
            await dispatch(revertSkill({ skillId: skill.id, versionNumber })).unwrap();
        } finally {
            setBusy(null);
        }
    };

    const baseVersion = compare ? byNumber.get(compare.base) : undefined;
    const targetVersion = compare ? byNumber.get(compare.target) : undefined;

    return (
        <Modal onClose={onClose} maxWidth="max-w-3xl" closeDisabled={busy !== null}>
            <div className="flex flex-col max-h-[85vh]">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
                    <ClockCounterClockwise size={20} className="text-primary shrink-0" />
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-foreground truncate">
                            Version history - {skill.displayName}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            {pinned
                                ? `Pinned to version ${activeNumber}`
                                : 'Following the latest edit automatically'}
                        </p>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {editable && (
                        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={!pinned}
                                disabled={busy !== null}
                                onChange={() => {
                                    if (pinned) handleFollowLatest();
                                }}
                                className="accent-primary"
                            />
                            Use the latest version automatically
                        </label>
                    )}

                    {compare && baseVersion && targetVersion && (
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>Compare</span>
                                <Select
                                    value={compare.base}
                                    onChange={(value) => setCompare({ ...compare, base: value })}
                                    size="sm"
                                    triggerClassName="min-w-0 w-20"
                                    options={versions.map((v) => ({
                                        value: v.versionNumber,
                                        label: `v${v.versionNumber}`,
                                    }))}
                                />
                                <span>with</span>
                                <Select
                                    value={compare.target}
                                    onChange={(value) => setCompare({ ...compare, target: value })}
                                    size="sm"
                                    triggerClassName="min-w-0 w-20"
                                    options={versions.map((v) => ({
                                        value: v.versionNumber,
                                        label: `v${v.versionNumber}`,
                                    }))}
                                />
                            </div>
                            <div className="max-h-72 overflow-hidden flex flex-col">
                                <SkillVersionDiff
                                    oldText={baseVersion.content}
                                    newText={targetVersion.content}
                                    oldLabel={`v${baseVersion.versionNumber}`}
                                    newLabel={`v${targetVersion.versionNumber}`}
                                />
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        {entry?.loading && versions.length === 0 && (
                            <div className="flex items-center justify-center py-8">
                                <CircleNotch size={20} className="animate-spin text-muted-foreground" />
                            </div>
                        )}
                        {!entry?.loading && versions.length === 0 && (
                            <p className="text-sm text-muted-foreground py-4">
                                No version history yet.
                            </p>
                        )}
                        {versions.map((version, i) => {
                            const prev = versions[i + 1];
                            const stat = prev ? diffStat(prev.content, version.content) : null;
                            const isMain = version.versionNumber === activeNumber;
                            const rowBusy = busy === version.versionNumber;
                            return (
                                <div
                                    key={version.id}
                                    className={cn(
                                        'rounded-lg border px-3 py-2.5',
                                        isMain
                                            ? 'border-primary/40 bg-primary/5'
                                            : 'border-border bg-card',
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
                                        <span className="text-xs text-muted-foreground">
                                            {version.authorKind === 'agent' ? 'Agent' : 'User'}
                                        </span>
                                        {stat && (stat.added > 0 || stat.removed > 0) && (
                                            <span className="text-xs font-mono">
                                                <span className="text-green-600 dark:text-green-400">
                                                    +{stat.added}
                                                </span>{' '}
                                                <span className="text-red-500">-{stat.removed}</span>
                                            </span>
                                        )}
                                        <span className="ml-auto text-xs text-muted-foreground">
                                            {formatProtoDateTime(version.createdAt)}
                                        </span>
                                    </div>
                                    {version.changeSummary && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {version.changeSummary}
                                        </p>
                                    )}
                                    {editable && (
                                        <div className="flex items-center gap-3 mt-2">
                                            {!isMain && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleSetMain(version.versionNumber)}
                                                    disabled={busy !== null}
                                                    className="text-xs text-primary hover:underline disabled:opacity-50"
                                                >
                                                    {rowBusy ? 'Working...' : 'Set as main'}
                                                </button>
                                            )}
                                            {version.versionNumber !== entry?.latestVersionNumber && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleRevert(version.versionNumber)}
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
                </div>

                <div className="flex items-center justify-end px-5 py-3 border-t border-border">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy !== null}
                        className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 disabled:opacity-50"
                    >
                        Close
                    </button>
                </div>
            </div>
        </Modal>
    );
}
