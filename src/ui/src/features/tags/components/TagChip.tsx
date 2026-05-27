import { Link } from 'react-router-dom';
import { X } from '@phosphor-icons/react';

import { cn } from '@/shared/utils/cn';
import { tagColorClasses } from '@/features/tags/utils/colors';
import type { SerializedTag } from '@/features/tags/store/tagsSlice';

interface TagChipProps {
    tag: Pick<SerializedTag, 'id' | 'name' | 'slug' | 'color'>;
    onRemove?: () => void;
    removeDisabled?: boolean;
    nonInteractive?: boolean;
    className?: string;
}

export function TagChip({
    tag,
    onRemove,
    removeDisabled = false,
    nonInteractive = false,
    className,
}: TagChipProps) {
    const palette = tagColorClasses(tag.slug, tag.color);

    const baseClass = cn(
        'group inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        palette.bg,
        palette.text,
        'hover:brightness-110',
        className
    );

    const inner = (
        <>
            <span className="truncate max-w-[14rem]">#{tag.slug}</span>
            {onRemove && (
                <button
                    type="button"
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (removeDisabled) return;
                        onRemove();
                    }}
                    className={cn(
                        '-mr-1 rounded-full p-0.5 transition-opacity',
                        removeDisabled
                            ? 'cursor-not-allowed opacity-30'
                            : 'opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10'
                    )}
                    aria-label={`Remove tag ${tag.name}`}
                    disabled={removeDisabled}
                >
                    <X size={12} weight="bold" />
                </button>
            )}
        </>
    );

    if (nonInteractive) {
        return <span className={baseClass}>{inner}</span>;
    }

    return (
        <Link to={`/tags/${tag.slug}`} className={baseClass}>
            {inner}
        </Link>
    );
}
