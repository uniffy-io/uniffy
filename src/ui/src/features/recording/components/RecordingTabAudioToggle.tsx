/**
 * Capture-tab-audio toggle. Only meaningful when source=tab, otherwise the
 * browser ignores the `audio: true` flag on `getDisplayMedia`. The popover
 * hides this control when source is screen or window.
 */

import { SpeakerHigh } from '@phosphor-icons/react';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { captureTabAudioChanged } from '@/features/recording/store/recordingSlice';

export function RecordingTabAudioToggle() {
    const dispatch = useAppDispatch();
    const captureTabAudio = useAppSelector((state) => state.recording.captureTabAudio);

    return (
        <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <SpeakerHigh size={14} weight="duotone" />
                Capture tab audio
            </span>
            <ToggleSwitch
                size="sm"
                enabled={captureTabAudio}
                onChange={(next) => dispatch(captureTabAudioChanged(next))}
            />
        </label>
    );
}
