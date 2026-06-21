import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Lightning } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import type { SerializedRunnableSkill } from '@/features/agents/store/agentRunnableSkillsThunks';

interface SkillSlashPopupProps {
    skills: SerializedRunnableSkill[];
    query: string;
    onSelect: (skill: SerializedRunnableSkill) => void;
    onClose: () => void;
}

export function SkillSlashPopup({ skills, query, onSelect, onClose }: SkillSlashPopupProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const [highlighted, setHighlighted] = useState(0);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return skills;
        return skills.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.displayName.toLowerCase().includes(q) ||
                s.description.toLowerCase().includes(q),
        );
    }, [skills, query]);

    // The query can narrow the list under a now-out-of-range index; clamp at
    // read time rather than syncing via an effect.
    const activeIndex = highlighted < filtered.length ? highlighted : 0;

    const select = useCallback(
        (skill: SerializedRunnableSkill | undefined) => {
            if (skill) onSelect(skill);
        },
        [onSelect],
    );

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlighted((h) => (filtered.length ? (h + 1) % filtered.length : 0));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlighted((h) => (filtered.length ? (h - 1 + filtered.length) % filtered.length : 0));
            } else if (e.key === 'Enter' && !e.shiftKey) {
                if (filtered.length) {
                    e.preventDefault();
                    select(filtered[activeIndex]);
                }
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [filtered, activeIndex, select, onClose]);

    useEffect(() => {
        const onClickOutside = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [onClose]);

    if (filtered.length === 0) {
        return (
            <div
                ref={popupRef}
                className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border bg-card shadow-xl overflow-hidden z-50"
                data-testid="skill-slash-popup"
            >
                <div className="px-4 py-3 text-sm text-muted-foreground">
                    No skills match <span className="font-mono">/{query}</span>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={popupRef}
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border bg-card shadow-xl overflow-hidden z-50"
            data-testid="skill-slash-popup"
        >
            <div className="px-3 py-1.5 border-b border-border/60 text-xs font-medium text-muted-foreground">
                Run a skill
            </div>
            <ul className="max-h-64 overflow-y-auto py-1">
                {filtered.map((skill, index) => (
                    <li key={skill.id}>
                        <button
                            type="button"
                            onMouseEnter={() => setHighlighted(index)}
                            onClick={() => select(skill)}
                            className={cn(
                                'w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors',
                                index === activeIndex ? 'bg-primary/10' : 'hover:bg-muted',
                            )}
                            data-testid="skill-slash-option"
                        >
                            <Lightning
                                size={16}
                                weight="fill"
                                className="mt-0.5 shrink-0 text-primary"
                            />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-2">
                                    <span className="font-mono text-sm text-foreground truncate">
                                        /{skill.name}
                                    </span>
                                    <span className="text-xs text-muted-foreground truncate">
                                        {skill.displayName}
                                    </span>
                                </span>
                                {(skill.description || skill.whenToUse) && (
                                    <span className="block text-xs text-muted-foreground/80 truncate">
                                        {skill.description || `Use when ${skill.whenToUse}`}
                                    </span>
                                )}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
