import { Warning } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import type { QuotaWarning } from '@/features/recording/utils/checkQuotaBeforeRecord';

interface RecordingQuotaBannerProps {
    warning: QuotaWarning;
}

export function RecordingQuotaBanner({ warning }: RecordingQuotaBannerProps) {
    const isExhausted = warning.remainingBytes <= 0;
    return (
        <div
            role="alert"
            className={cn(
                'flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs',
                isExhausted
                    ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
            )}
        >
            <Warning size={14} weight="fill" className="shrink-0 mt-0.5" />
            <span className="leading-snug">{warning.message}</span>
        </div>
    );
}
