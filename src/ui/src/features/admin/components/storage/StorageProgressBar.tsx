import { useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { formatFileSize } from '@/shared/utils/dateFormatting';

interface StorageProgressBarProps {
    usedBytes: number;
    quotaBytes: number | null;
    warnAtPercent?: number;
    showLabels?: boolean;
    className?: string;
    size?: 'sm' | 'md' | 'lg';
}

function getBarColor(percent: number, warnAt: number): string {
    if (percent >= 95) return 'bg-red-500';
    if (percent >= warnAt) return 'bg-orange-500';
    if (percent >= 60) return 'bg-yellow-500';
    return 'bg-emerald-500';
}

export function StorageProgressBar({
    usedBytes,
    quotaBytes,
    warnAtPercent = 80,
    showLabels = true,
    className,
    size = 'md',
}: StorageProgressBarProps) {
    const { percent, label } = useMemo(() => {
        if (quotaBytes === null || quotaBytes === 0) {
            return {
                percent: 0,
                label: `${formatFileSize(usedBytes)} used (unlimited)`,
            };
        }
        const pct = Math.min(100, (usedBytes / quotaBytes) * 100);
        return {
            percent: pct,
            label: `${formatFileSize(usedBytes)} of ${formatFileSize(quotaBytes)} used (${pct.toFixed(1)}%)`,
        };
    }, [usedBytes, quotaBytes]);

    const barColor = getBarColor(percent, warnAtPercent);

    const heights: Record<string, string> = {
        sm: 'h-1.5',
        md: 'h-2.5',
        lg: 'h-4',
    };

    return (
        <div className={cn('w-full', className)}>
            <div className={cn('w-full rounded-full bg-muted overflow-hidden', heights[size])}>
                <div
                    className={cn('h-full rounded-full transition-all duration-300', barColor)}
                    style={{ width: quotaBytes ? `${Math.max(0.5, percent)}%` : '0%' }}
                />
            </div>
            {showLabels && (
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            )}
        </div>
    );
}
