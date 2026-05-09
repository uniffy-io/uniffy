/**
 * Translate the user's recording-source preference (entire screen / specific
 * window / browser tab) into a `DisplayMediaStreamOptions` payload.
 *
 * `displaySurface` is a hint - the browser's native picker still has the final
 * say, especially on Firefox where the field is ignored. `surfaceSwitching`
 * lets the user swap between captured surfaces mid-recording on Chrome
 * without restarting the picker.
 *
 * Tab-audio capture is opt-in: `audio: true` is only set when source=tab AND
 * the user toggled the option. Otherwise we leave `audio: false` and route
 * the microphone in via `getUserMedia` instead, which is more reliable on
 * Chrome/Brave (their tab-audio path drops audio when the captured tab
 * switches surfaces).
 */

import type { RecordingSource } from '@/features/recording/store/recordingSlice';

export interface DisplayMediaPrefs {
    source: RecordingSource;
    captureTabAudio: boolean;
}

const SOURCE_TO_DISPLAY_SURFACE: Record<RecordingSource, string> = {
    screen: 'monitor',
    window: 'window',
    tab: 'browser',
};

export function buildDisplayMediaConstraints(
    prefs: DisplayMediaPrefs,
): DisplayMediaStreamOptions {
    const wantsTabAudio = prefs.source === 'tab' && prefs.captureTabAudio;
    const video: MediaTrackConstraints & { displaySurface?: string } = {
        displaySurface: SOURCE_TO_DISPLAY_SURFACE[prefs.source],
    };
    const options: DisplayMediaStreamOptions & {
        surfaceSwitching?: 'include' | 'exclude';
        selfBrowserSurface?: 'include' | 'exclude';
    } = {
        video,
        audio: wantsTabAudio,
    };
    if (prefs.source === 'tab') {
        options.surfaceSwitching = 'include';
    }
    return options;
}

export function isTabAudioSupported(): boolean {
    if (typeof navigator === 'undefined') return false;
    if (!navigator.mediaDevices?.getDisplayMedia) return false;
    return true;
}
