/**
 * Module-level singleton owning the MediaRecorder, merged MediaStream, and StreamingUploader
 * (non-serialisable, so outside Redux). Mic permission denial is silent; only screen denial fails the recording.
 */

import { buildRecordingFilename } from '@/features/recording/utils/buildRecordingFilename';
import {
    buildDisplayMediaConstraints,
} from '@/features/recording/utils/getDisplayMediaConstraints';
import { mergeAudioTracks } from '@/features/recording/utils/mergeAudioTracks';
import {
    getContainerMimeType,
    pickRecordingMimeType,
} from '@/features/recording/utils/pickRecordingMimeType';
import type { RecordingSource } from '@/features/recording/store/recordingSlice';
import { StreamingUploader } from '@/features/recording/utils/streamingUploader';
import type { BackpressureLevel } from '@/features/recording/utils/uploadBackpressure';

interface ControllerConfig {
    organizationId: string;
    folderId: string | null;
    source: RecordingSource;
    micDeviceId: string | null;
    captureTabAudio: boolean;
    onChunkUploaded: (info: { queued: number; uploaded: number }) => void;
    onAuthLost: () => void;
    onTrackEnded: () => void;
    onError: (error: Error) => void;
    onBackpressure?: (level: BackpressureLevel) => void;
}

export interface ControllerStartResult {
    uploadId: string;
    mimeType: string;
    filename: string;
    hasAudio: boolean;
}

const TIMESLICE_MS = 5_000;

class RecordingController {
    private mediaRecorder: MediaRecorder | null = null;
    private displayStream: MediaStream | null = null;
    private micStream: MediaStream | null = null;
    private mergedStream: MediaStream | null = null;
    private audioContext: AudioContext | null = null;
    private uploader: StreamingUploader | null = null;

    async start(config: ControllerConfig): Promise<ControllerStartResult> {
        if (this.mediaRecorder) {
            throw new Error('Recording already in progress');
        }
        if (!navigator.mediaDevices?.getDisplayMedia) {
            throw Object.assign(new Error('Screen recording is not supported in this browser'), {
                code: 'not_supported',
            });
        }

        let displayStream: MediaStream;
        try {
            displayStream = await navigator.mediaDevices.getDisplayMedia(
                buildDisplayMediaConstraints({
                    source: config.source,
                    captureTabAudio: config.captureTabAudio,
                }),
            );
        } catch (err) {
            const e = err as { name?: string };
            if (e?.name === 'NotAllowedError') {
                throw Object.assign(
                    new Error('Screen recording permission denied'),
                    { code: 'permission_denied' },
                );
            }
            throw Object.assign(
                new Error('Could not start screen capture'),
                { code: 'not_supported' },
            );
        }

        let micStream: MediaStream | null = null;
        if (config.micDeviceId !== null && navigator.mediaDevices?.getUserMedia) {
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: { deviceId: { exact: config.micDeviceId } },
                    video: false,
                });
            } catch {
                micStream = null;
            }
        }

        const { track: mixedAudioTrack, audioContext } = await mergeAudioTracks(
            [displayStream, micStream].filter((s): s is MediaStream => s !== null),
        );

        const videoTrack = displayStream.getVideoTracks()[0];
        if (!videoTrack) {
            displayStream.getTracks().forEach((t) => t.stop());
            micStream?.getTracks().forEach((t) => t.stop());
            audioContext?.close().catch(() => undefined);
            throw Object.assign(
                new Error('Could not start screen capture'),
                { code: 'not_supported' },
            );
        }

        videoTrack.addEventListener('ended', () => {
            config.onTrackEnded();
        });

        const tracks: MediaStreamTrack[] = [videoTrack];
        if (mixedAudioTrack) {
            tracks.push(mixedAudioTrack);
        }
        const mergedStream = new MediaStream(tracks);
        const hasAudio = mixedAudioTrack !== null;

        const mimeType = pickRecordingMimeType(hasAudio);
        if (!mimeType) {
            displayStream.getTracks().forEach((t) => t.stop());
            micStream?.getTracks().forEach((t) => t.stop());
            audioContext?.close().catch(() => undefined);
            throw Object.assign(
                new Error("Your browser doesn't support recording in MP4 or WebM"),
                { code: 'not_supported' },
            );
        }

        const recorder = new MediaRecorder(mergedStream, { mimeType });
        const containerMime = getContainerMimeType(mimeType);
        // Filename is always `.mp4`: WebM bytes get transcoded server-side and `storage_key` swaps atomically.
        const filename = buildRecordingFilename('mp4');
        const uploader = new StreamingUploader({
            organizationId: config.organizationId,
            folderId: config.folderId,
            filename,
            mimeType: containerMime,
            onProgress: config.onChunkUploaded,
            onAuthLost: config.onAuthLost,
            onBackpressure: config.onBackpressure,
        });

        try {
            const uploadId = await uploader.start();
            recorder.addEventListener('dataavailable', (event) => {
                if (event.data && event.data.size > 0) {
                    uploader.pushChunk(event.data);
                }
            });
            recorder.addEventListener('error', (event) => {
                const e = event as Event & { error?: { name?: string; message?: string } };
                const name = e?.error?.name ?? 'Error';
                const message = e?.error?.message ?? '';
                const detail = message ? `${name}: ${message}` : name;
                console.error(
                    '[recording] MediaRecorder error event',
                    { name, message, mimeType, errorEvent: e },
                );
                config.onError(new Error(`MediaRecorder ${detail} (mime=${mimeType})`));
            });
            try {
                recorder.start(TIMESLICE_MS);
            } catch (err) {
                const e = err as { name?: string; message?: string };
                console.error(
                    '[recording] MediaRecorder.start() threw',
                    { name: e?.name, message: e?.message, mimeType, err },
                );
                config.onError(
                    new Error(
                        `MediaRecorder.start() threw ${e?.name ?? 'Error'}: ${e?.message ?? ''} (mime=${mimeType})`,
                    ),
                );
                throw err;
            }

            this.mediaRecorder = recorder;
            this.displayStream = displayStream;
            this.micStream = micStream;
            this.mergedStream = mergedStream;
            this.audioContext = audioContext;
            this.uploader = uploader;
            return { uploadId, mimeType, filename, hasAudio };
        } catch (err) {
            displayStream.getTracks().forEach((t) => t.stop());
            micStream?.getTracks().forEach((t) => t.stop());
            audioContext?.close().catch(() => undefined);
            await uploader.cancel().catch(() => undefined);
            throw err;
        }
    }

    pause(): void {
        if (!this.mediaRecorder) return;
        if (this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.pause();
        }
    }

    /** Flips `track.enabled` on mic tracks; merged destination keeps producing silence so the encoder stays happy. Tab audio is not muted. */
    setMicMuted(muted: boolean): void {
        if (!this.micStream) return;
        for (const track of this.micStream.getAudioTracks()) {
            track.enabled = !muted;
        }
    }

    hasMic(): boolean {
        return this.micStream !== null;
    }

    resume(): void {
        if (!this.mediaRecorder) return;
        if (this.mediaRecorder.state === 'paused') {
            this.mediaRecorder.resume();
        }
    }

    isPaused(): boolean {
        return this.mediaRecorder?.state === 'paused';
    }

    async stop(): Promise<{ fileId: string; filename: string }> {
        if (!this.mediaRecorder || !this.uploader) {
            throw new Error('No recording in progress');
        }
        const recorder = this.mediaRecorder;
        const uploader = this.uploader;
        const displayStream = this.displayStream;
        const micStream = this.micStream;
        const mergedStream = this.mergedStream;
        const audioContext = this.audioContext;

        // `MediaRecorder.stop()` is a no-op while paused on some browsers; resume first so the final chunk flushes.
        if (recorder.state === 'paused') {
            try {
                recorder.resume();
            } catch {
                // ignored - encoder will still emit `stop` if active
            }
        }

        await new Promise<void>((resolve) => {
            const handleStop = () => {
                recorder.removeEventListener('stop', handleStop);
                resolve();
            };
            recorder.addEventListener('stop', handleStop);
            try {
                recorder.stop();
            } catch {
                resolve();
            }
        });

        displayStream?.getTracks().forEach((t) => t.stop());
        micStream?.getTracks().forEach((t) => t.stop());
        mergedStream?.getTracks().forEach((t) => t.stop());
        audioContext?.close().catch(() => undefined);

        this.mediaRecorder = null;
        this.displayStream = null;
        this.micStream = null;
        this.mergedStream = null;
        this.audioContext = null;

        try {
            const result = await uploader.finish();
            this.uploader = null;
            return result;
        } catch (err) {
            this.uploader = null;
            throw err;
        }
    }

    async cancel(): Promise<void> {
        const recorder = this.mediaRecorder;
        const displayStream = this.displayStream;
        const micStream = this.micStream;
        const mergedStream = this.mergedStream;
        const audioContext = this.audioContext;
        const uploader = this.uploader;
        this.mediaRecorder = null;
        this.displayStream = null;
        this.micStream = null;
        this.mergedStream = null;
        this.audioContext = null;
        this.uploader = null;
        try {
            recorder?.stop();
        } catch {
            // ignore
        }
        displayStream?.getTracks().forEach((t) => t.stop());
        micStream?.getTracks().forEach((t) => t.stop());
        mergedStream?.getTracks().forEach((t) => t.stop());
        audioContext?.close().catch(() => undefined);
        await uploader?.cancel().catch(() => undefined);
    }

    isActive(): boolean {
        return this.mediaRecorder !== null;
    }
}

export const recordingController = new RecordingController();
