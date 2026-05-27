import { Monitor, AppWindow, Browsers } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    sourceChanged,
    type RecordingSource,
} from '@/features/recording/store/recordingSlice';

interface SourceOption {
    value: RecordingSource;
    label: string;
    description: string;
    Icon: typeof Monitor;
}

const OPTIONS: readonly SourceOption[] = [
    {
        value: 'screen',
        label: 'Entire screen',
        description: 'Capture the whole display',
        Icon: Monitor,
    },
    {
        value: 'window',
        label: 'Window',
        description: 'A single application window',
        Icon: AppWindow,
    },
    {
        value: 'tab',
        label: 'Browser tab',
        description: 'One tab in this browser',
        Icon: Browsers,
    },
];

export function RecordingSourcePicker() {
    const dispatch = useAppDispatch();
    const source = useAppSelector((state) => state.recording.source);

    return (
        <div role="radiogroup" aria-label="Recording source" className="grid grid-cols-3 gap-2">
            {OPTIONS.map(({ value, label, description, Icon }) => {
                const isActive = source === value;
                return (
                    <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => dispatch(sourceChanged(value))}
                        title={description}
                        className={cn(
                            'flex flex-col items-center justify-center gap-1.5 rounded-md border px-2 py-3 text-xs',
                            'transition-colors duration-150',
                            isActive
                                ? 'border-primary/50 bg-primary/10 text-primary'
                                : 'border-border bg-card text-muted-foreground hover:border-border/80 hover:text-foreground',
                        )}
                    >
                        <Icon size={20} weight={isActive ? 'fill' : 'duotone'} />
                        <span className="font-medium">{label}</span>
                    </button>
                );
            })}
        </div>
    );
}
