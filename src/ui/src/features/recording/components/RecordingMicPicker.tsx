/**
 * Microphone picker for the recording popover.
 *
 * "No microphone" is the first option and the default. The device list is
 * lazy-loaded on popover open via `listMicrophones`. Browsers withhold device
 * labels until the user has granted mic permission to the origin at least
 * once, so a fallback "Microphone (xxxxxx)" name is shown until the first
 * recording with the mic on populates the labels.
 */

import { useEffect, useState } from 'react';
import { Microphone, MicrophoneSlash } from '@phosphor-icons/react';
import { Select, type SelectOption } from '@/components/ui/select';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { micDeviceChanged } from '@/features/recording/store/recordingSlice';
import {
    listMicrophones,
    type MicrophoneDevice,
} from '@/features/recording/utils/microphoneDevices';

const NONE_VALUE = '__none__';

interface RecordingMicPickerProps {
    enabled: boolean;
}

export function RecordingMicPicker({ enabled }: RecordingMicPickerProps) {
    const dispatch = useAppDispatch();
    const micDeviceId = useAppSelector((state) => state.recording.micDeviceId);
    const [devices, setDevices] = useState<MicrophoneDevice[]>([]);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        void (async () => {
            const list = await listMicrophones();
            if (!cancelled) setDevices(list);
        })();
        return () => {
            cancelled = true;
        };
    }, [enabled]);

    const options: SelectOption<string>[] = [
        { value: NONE_VALUE, label: 'No microphone' },
        ...devices.map((d) => ({ value: d.deviceId, label: d.label })),
    ];

    const value = micDeviceId ?? NONE_VALUE;

    return (
        <div className="flex items-center gap-2">
            <span className="shrink-0 text-muted-foreground" aria-hidden="true">
                {value === NONE_VALUE ? (
                    <MicrophoneSlash size={16} weight="duotone" />
                ) : (
                    <Microphone size={16} weight="duotone" />
                )}
            </span>
            <div className="flex-1 min-w-0">
                <Select
                    size="sm"
                    value={value}
                    onChange={(next) => {
                        dispatch(micDeviceChanged(next === NONE_VALUE ? null : next));
                    }}
                    options={options}
                    placeholder="No microphone"
                />
            </div>
        </div>
    );
}
