/**
 * Builds `getDisplayMedia` constraints. `displaySurface` is only a hint (Firefox ignores it).
 * Tab audio (`audio: true`) is gated on source=tab; Chrome/Brave drop tab audio on surface switch,
 * so mic routes via `getUserMedia` instead.
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
