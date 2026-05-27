import { useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { tagColorClasses } from '@/features/tags/utils/colors';
import type { SerializedTag } from '@/features/tags/store/tagsThunks';

interface TagCloudProps {
    tags: SerializedTag[];
    selectedTagId: string | null;
    onSelect: (tag: SerializedTag) => void;
    limit?: number;
}

const MIN_COUNT = 1;
const FONT_SCALE = [
    'text-xs',
    'text-sm',
    'text-base',
    'text-lg',
    'text-xl',
    'text-2xl',
] as const;

function bucketize(count: number, max: number): number {
    if (max <= MIN_COUNT) return 0;
    const ratio = Math.log(count + 1) / Math.log(max + 1);
    return Math.min(FONT_SCALE.length - 1, Math.floor(ratio * FONT_SCALE.length));
}

export function TagCloud({
    tags,
    selectedTagId,
    onSelect,
    limit = 200,
}: TagCloudProps) {
    const limited = useMemo(() => tags.slice(0, limit), [tags, limit]);
    const max = useMemo(
        () => limited.reduce((m, t) => Math.max(m, t.usageCount), 0),
        [limited]
    );

    if (limited.length === 0) {
        return (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                No tags match the current filter.
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-2 px-3 py-4">
            {limited.map((tag) => {
                const palette = tagColorClasses(tag.slug, tag.color);
                const fontClass = FONT_SCALE[bucketize(tag.usageCount, max)];
                const isSelected = tag.id === selectedTagId;
                return (
                    <button
                        key={tag.id}
                        type="button"
                        onClick={() => onSelect(tag)}
                        className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium transition-all',
                            palette.bg,
                            palette.text,
                            fontClass,
                            isSelected
                                ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                                : 'hover:brightness-110'
                        )}
                    >
                        <span>#{tag.slug}</span>
                        <span className="text-[10px] opacity-70">{tag.usageCount}</span>
                    </button>
                );
            })}
        </div>
    );
}
