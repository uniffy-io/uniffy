/** Streams via Range for immediate playback; waveform is built in the background and skipped for files >100MB. */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import WaveSurfer from 'wavesurfer.js';
import {
    Play,
    Pause,
    SkipBack,
    SkipForward,
    SpeakerHigh,
    SpeakerSlash,
    SpeakerLow,
    MusicNote,
    Repeat,
    Shuffle,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    setPlaying,
    setCurrentTime,
    setDuration,
    setMuted,
    setVolume,
    setViewerLoading,
} from '@/features/files/store/viewerSlice';
import { useMediaStream } from '@/features/files/components/viewer/hooks/useMediaStream';
import type { SerializedFile } from '@/features/files/store/filesThunks';
import { formatFileSize, supportsThumbnail } from '@/features/files/components/list/utils';
import { formatMediaTime } from '@/shared/utils/dateFormatting';
import { ExtractionStatus } from '@uniffy/proto/files/v1/files_pb';
import { useThumbnailUrl } from '@/features/files/hooks/useThumbnail';

/** Files larger than this skip background waveform computation. */
const WAVEFORM_SIZE_LIMIT = 100 * 1024 * 1024; // 100 MB

/** Number of bars in the placeholder waveform. */
const PLACEHOLDER_BARS = 200;

interface AudioViewerProps {
    file: SerializedFile;
}

/** Flat placeholder bars rendered while real peaks compute in the background. */
function generatePlaceholderPeaks(count: number): Float32Array {
    const peaks = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        peaks[i] = 0.3;
    }
    return peaks;
}

export function AudioViewer({ file }: AudioViewerProps) {
    const dispatch = useAppDispatch();
    const { isPlaying, currentTime, duration, volume, isMuted } = useAppSelector(
        (state) => state.fileViewer
    );
    // Range-based streaming (no full download) - playback starts immediately
    const { url: streamUrl, loading: swLoading, error: swError } = useMediaStream(file.id);

    const containerRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const discRef = useRef<HTMLDivElement>(null);
    const rotationRef = useRef(0);
    const animFrameRef = useRef(0);
    const isPlayingRef = useRef(isPlaying);
    const scratchRef = useRef({
        isDragging: false,
        lastAngle: 0,
        wasPlaying: false,
    });
    const [isReady, setIsReady] = useState(false);
    const [isLooping, setIsLooping] = useState(false);
    const [isShuffled, setIsShuffled] = useState(false);
    const [isScratching, setIsScratching] = useState(false);
    const [albumArtError, setAlbumArtError] = useState(false);

    // Keep ref in sync with play state for rAF loop
    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    // Album art thumbnail from audio metadata
    const hasAlbumArt = file.extractionStatus === ExtractionStatus.COMPLETED
        && supportsThumbnail(file.mimeType)
        && !albumArtError;
    const { url: thumbnailUrl } = useThumbnailUrl(hasAlbumArt ? file.id : null);
    const albumArtUrl = hasAlbumArt && thumbnailUrl
        ? `${thumbnailUrl}?v=${file.extractionStatus}`
        : null;

    const [primaryColor] = useState(() => {
        const root = document.documentElement;
        const computedStyle = getComputedStyle(root);
        const primaryHsl = computedStyle.getPropertyValue('--primary').trim();
        return primaryHsl ? `hsl(${primaryHsl})` : 'hsl(262, 83%, 58%)';
    });

    const progressPercent = useMemo(() => {
        if (!duration || duration === 0) return 0;
        return (currentTime / duration) * 100;
    }, [currentTime, duration]);

    const circleRadius = 110;
    const circumference = 2 * Math.PI * circleRadius;
    const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

    // Available from metadata before the audio element has loaded.
    const fileDuration = file.metadata?.durationSeconds ?? 0;

    // Hidden <audio> element so playback uses Range requests for seeking.
    useEffect(() => {
        if (!containerRef.current || !streamUrl || !audioRef.current) return;

        dispatch(setViewerLoading(true));
        setIsReady(false);

        const audio = audioRef.current;
        audio.src = streamUrl;

        const root = document.documentElement;
        const computedStyle = getComputedStyle(root);
        const primaryHsl = computedStyle.getPropertyValue('--primary').trim();
        const waveColorBase = primaryHsl ? `hsl(${primaryHsl}` : 'hsl(262, 83%, 58%';

        // Show placeholder bars while the real peaks load.
        const placeholderPeaks = generatePlaceholderPeaks(PLACEHOLDER_BARS);

        const wavesurfer = WaveSurfer.create({
            container: containerRef.current,
            waveColor: `${waveColorBase} / 0.3)`,
            progressColor: `${waveColorBase} / 0.9)`,
            cursorColor: 'transparent',
            height: 80,
            barWidth: 3,
            barGap: 2,
            barRadius: 3,
            normalize: true,
            media: audio,
            peaks: [Array.from(placeholderPeaks)],
            duration: fileDuration || undefined,
        });

        wavesurferRef.current = wavesurfer;

        wavesurfer.on('ready', () => {
            dispatch(setDuration(wavesurfer.getDuration()));
            dispatch(setViewerLoading(false));
            setIsReady(true);
        });

        wavesurfer.on('play', () => {
            dispatch(setPlaying(true));
        });

        wavesurfer.on('pause', () => {
            dispatch(setPlaying(false));
        });

        wavesurfer.on('timeupdate', (time) => {
            dispatch(setCurrentTime(time));
        });

        wavesurfer.on('finish', () => {
            dispatch(setPlaying(false));
        });

        wavesurfer.on('error', (error) => {
            if (error instanceof Error && error.name === 'AbortError') {
                return;
            }
            console.error('WaveSurfer error:', error);
            dispatch(setViewerLoading(false));
        });

        return () => {
            wavesurfer.unAll();
            wavesurfer.destroy();
            wavesurferRef.current = null;
        };
    }, [streamUrl, dispatch, fileDuration]);

    // Background waveform: fetch the whole file, decode, then swap in real peaks. Skipped above WAVEFORM_SIZE_LIMIT.
    useEffect(() => {
        if (!streamUrl || !isReady) return;

        if (file.sizeBytes > WAVEFORM_SIZE_LIMIT) {
            return;
        }

        const ac = new AbortController();
        const fullUrl = streamUrl.includes('?') ? `${streamUrl}&full=true` : `${streamUrl}?full=true`;

        (async () => {
            try {
                const res = await fetch(fullUrl, { signal: ac.signal });
                const arrayBuffer = await res.arrayBuffer();

                const audioCtx = new AudioContext();
                try {
                    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
                    const channel = decoded.getChannelData(0);
                    const numBars = PLACEHOLDER_BARS;
                    const blockSize = Math.floor(channel.length / numBars) || 1;
                    const peaks = new Float32Array(numBars);
                    let max = 0;

                    for (let i = 0; i < numBars; i++) {
                        let sum = 0;
                        const offset = i * blockSize;
                        const end = Math.min(offset + blockSize, channel.length);
                        for (let j = offset; j < end; j++) {
                            sum += Math.abs(channel[j]);
                        }
                        const avg = sum / (end - offset);
                        peaks[i] = avg;
                        if (avg > max) max = avg;
                    }
                    if (max > 0) {
                        for (let i = 0; i < numBars; i++) peaks[i] /= max;
                    }

                    const ws = wavesurferRef.current;
                    if (ws) {
                        ws.load(streamUrl, [Array.from(peaks)], decoded.duration);
                    }
                } finally {
                    await audioCtx.close();
                }
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                console.warn('[AudioViewer] Background waveform computation failed:', err);
            }
        })();

        return () => {
            ac.abort();
        };
    }, [streamUrl, isReady, file.sizeBytes]);

    useEffect(() => {
        const ws = wavesurferRef.current;
        if (!ws || !isReady) return;

        if (isPlaying && !ws.isPlaying()) {
            ws.play();
        } else if (!isPlaying && ws.isPlaying()) {
            ws.pause();
        }
    }, [isPlaying, isReady]);

    // Sync volume
    useEffect(() => {
        const ws = wavesurferRef.current;
        if (!ws) return;

        ws.setVolume(isMuted ? 0 : volume);
    }, [volume, isMuted]);

    // JS-driven disc rotation (replaces CSS animation for scratch support)
    useEffect(() => {
        if (!isReady) return;

        const DEGREES_PER_SECOND = 120; // 360deg / 3s, same speed as the old CSS animation
        let lastTimestamp = 0;

        function spin(timestamp: number) {
            if (lastTimestamp === 0) lastTimestamp = timestamp;
            const delta = (timestamp - lastTimestamp) / 1000;
            lastTimestamp = timestamp;

            if (isPlayingRef.current && !scratchRef.current.isDragging) {
                rotationRef.current += DEGREES_PER_SECOND * delta;
            }

            if (discRef.current) {
                discRef.current.style.transform = `rotate(${rotationRef.current}deg)`;
            }

            animFrameRef.current = requestAnimationFrame(spin);
        }

        animFrameRef.current = requestAnimationFrame(spin);

        return () => {
            cancelAnimationFrame(animFrameRef.current);
        };
    }, [isReady]);

    const getAngleFromCenter = useCallback((clientX: number, clientY: number) => {
        const disc = discRef.current;
        if (!disc) return 0;
        const rect = disc.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        return Math.atan2(clientY - centerY, clientX - centerX) * (180 / Math.PI);
    }, []);

    // Scratch: mousedown on disc
    const handleScratchStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const ws = wavesurferRef.current;
        if (!ws || !isReady) return;

        scratchRef.current.isDragging = true;
        scratchRef.current.wasPlaying = isPlaying;
        scratchRef.current.lastAngle = getAngleFromCenter(e.clientX, e.clientY);

        if (isPlaying) {
            ws.pause();
        }

        setIsScratching(true);
        document.body.style.cursor = 'grabbing';
    }, [isPlaying, isReady, getAngleFromCenter]);

    // Scratch: mousemove (global)
    const handleScratchMove = useCallback((e: MouseEvent) => {
        if (!scratchRef.current.isDragging) return;
        const ws = wavesurferRef.current;
        if (!ws) return;

        const currentAngle = getAngleFromCenter(e.clientX, e.clientY);
        let delta = currentAngle - scratchRef.current.lastAngle;

        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;

        scratchRef.current.lastAngle = currentAngle;

        rotationRef.current += delta;
        if (discRef.current) {
            discRef.current.style.transform = `rotate(${rotationRef.current}deg)`;
        }

        // Map rotation to time: one full turn = 5 seconds of audio
        const SECONDS_PER_REVOLUTION = 5;
        const timeChange = (delta / 360) * SECONDS_PER_REVOLUTION;
        const newTime = Math.max(0, Math.min(ws.getDuration(), ws.getCurrentTime() + timeChange));
        ws.setTime(newTime);
    }, [getAngleFromCenter]);

    // Scratch: mouseup (global)
    const handleScratchEnd = useCallback(() => {
        if (!scratchRef.current.isDragging) return;
        scratchRef.current.isDragging = false;

        setIsScratching(false);
        document.body.style.cursor = '';

        if (scratchRef.current.wasPlaying) {
            wavesurferRef.current?.play();
        }
    }, []);

    // Global mouse listeners for scratch
    useEffect(() => {
        window.addEventListener('mousemove', handleScratchMove);
        window.addEventListener('mouseup', handleScratchEnd);
        return () => {
            window.removeEventListener('mousemove', handleScratchMove);
            window.removeEventListener('mouseup', handleScratchEnd);
            document.body.style.cursor = '';
        };
    }, [handleScratchMove, handleScratchEnd]);

    // Control handlers
    const handlePlayPause = useCallback(() => {
        const ws = wavesurferRef.current;
        if (!ws) return;
        ws.playPause();
    }, []);

    const handleSkipBack = useCallback(() => {
        const ws = wavesurferRef.current;
        if (!ws) return;
        ws.setTime(Math.max(0, ws.getCurrentTime() - 10));
    }, []);

    const handleSkipForward = useCallback(() => {
        const ws = wavesurferRef.current;
        if (!ws) return;
        ws.setTime(Math.min(ws.getDuration(), ws.getCurrentTime() + 10));
    }, []);

    const handleToggleMute = useCallback(() => {
        dispatch(setMuted(!isMuted));
    }, [dispatch, isMuted]);

    const handleVolumeChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            dispatch(setVolume(parseFloat(e.target.value)));
            if (isMuted) {
                dispatch(setMuted(false));
            }
        },
        [dispatch, isMuted]
    );

    const VolumeIcon = isMuted ? SpeakerSlash : volume < 0.5 ? SpeakerLow : SpeakerHigh;

    if (swLoading) {
        return (
            <div className="viewer-loading">
                <span>Initializing media player...</span>
            </div>
        );
    }

    if (swError) {
        return (
            <div className="viewer-error">
                <p>{swError}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="viewer-btn px-4 py-2"
                >
                    Refresh Page
                </button>
            </div>
        );
    }

    if (!streamUrl) {
        return (
            <div className="viewer-error">
                <p>Unable to load audio</p>
            </div>
        );
    }

    return (
        <div className="audio-player-container">
            {/* Hidden audio element for Range-based streaming playback */}
            <audio ref={audioRef} preload="metadata" style={{ display: 'none' }} />

            {/* Ambient background glow */}
            <div className="audio-ambient-glow" />

            {/* Floating particles */}
            <div className="audio-particles">
                {[...Array(12)].map((_, i) => (
                    <div
                        key={i}
                        className="audio-particle"
                        style={{
                            left: `${10 + (i * 7) % 80}%`,
                            animationDelay: `${i * 0.4}s`,
                            animationDuration: `${4 + (i % 3)}s`,
                        }}
                    />
                ))}
            </div>

            <div className="audio-player-content">
                {/* Vinyl disc with progress ring */}
                <div className="audio-disc-container">
                    {/* Progress ring SVG */}
                    <svg className="audio-progress-ring" viewBox="0 0 240 240">
                        {/* Background track */}
                        <circle
                            cx="120"
                            cy="120"
                            r={circleRadius}
                            fill="none"
                            stroke="rgba(255, 255, 255, 0.1)"
                            strokeWidth="4"
                        />
                        {/* Progress arc */}
                        <circle
                            cx="120"
                            cy="120"
                            r={circleRadius}
                            fill="none"
                            stroke={primaryColor}
                            strokeWidth="4"
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            transform="rotate(-90 120 120)"
                            className="audio-progress-arc"
                        />
                    </svg>

                    {/* Vinyl disc - draggable for DJ scratching */}
                    <div
                        ref={discRef}
                        className={`audio-vinyl-disc ${isScratching ? 'scratching' : ''}`}
                        onMouseDown={handleScratchStart}
                    >
                        {/* Album art background (visible through grooves) */}
                        {albumArtUrl && (
                            <img
                                src={albumArtUrl}
                                alt=""
                                className="audio-disc-art"
                                onError={() => setAlbumArtError(true)}
                            />
                        )}

                        {/* Disc grooves */}
                        <div className="audio-disc-grooves">
                            {[...Array(8)].map((_, i) => (
                                <div
                                    key={i}
                                    className="audio-disc-groove"
                                    style={{
                                        width: `${100 - i * 10}%`,
                                        height: `${100 - i * 10}%`
                                    }}
                                />
                            ))}
                        </div>

                        {/* Center label */}
                        <div className="audio-disc-label">
                            {albumArtUrl ? (
                                <img
                                    src={albumArtUrl}
                                    alt=""
                                    className="audio-disc-label-art"
                                    onError={() => setAlbumArtError(true)}
                                />
                            ) : (
                                <MusicNote size={32} weight="fill" className="audio-disc-icon" />
                            )}
                        </div>

                        {/* Light reflection */}
                        <div className="audio-disc-reflection" />
                    </div>
                </div>

                {/* File info */}
                <div className="audio-info">
                    <h2 className="audio-title">{file.filename}</h2>
                    <p className="audio-meta">{formatFileSize(file.sizeBytes)}</p>
                </div>

                {/* Waveform */}
                <div className="audio-waveform-wrapper">
                    <div ref={containerRef} className="audio-waveform" />
                </div>

                {/* Time display */}
                <div className="audio-time-display">
                    <span className="audio-time-current">{formatMediaTime(currentTime)}</span>
                    <div className="audio-time-divider" />
                    <span className="audio-time-duration">{formatMediaTime(duration)}</span>
                </div>

                {/* Main controls */}
                <div className="audio-controls">
                    {/* Shuffle button */}
                    <button
                        onClick={() => setIsShuffled(!isShuffled)}
                        className={`audio-btn-secondary ${isShuffled ? 'active' : ''}`}
                        title="Shuffle"
                    >
                        <Shuffle size={18} weight={isShuffled ? 'fill' : 'regular'} />
                    </button>

                    {/* Skip back */}
                    <button
                        onClick={handleSkipBack}
                        className="audio-btn"
                        title="Skip back 10s"
                    >
                        <SkipBack size={24} weight="fill" />
                    </button>

                    {/* Play/Pause - Main button */}
                    <button
                        onClick={handlePlayPause}
                        className="audio-btn-play"
                        title={isPlaying ? 'Pause' : 'Play'}
                    >
                        <div className="audio-btn-play-inner">
                            {isPlaying ? (
                                <Pause size={28} weight="fill" />
                            ) : (
                                <Play size={28} weight="fill" className="ml-0.5" />
                            )}
                        </div>
                    </button>

                    {/* Skip forward */}
                    <button
                        onClick={handleSkipForward}
                        className="audio-btn"
                        title="Skip forward 10s"
                    >
                        <SkipForward size={24} weight="fill" />
                    </button>

                    {/* Loop button */}
                    <button
                        onClick={() => setIsLooping(!isLooping)}
                        className={`audio-btn-secondary ${isLooping ? 'active' : ''}`}
                        title="Repeat"
                    >
                        <Repeat size={18} weight={isLooping ? 'fill' : 'regular'} />
                    </button>
                </div>

                {/* Volume control */}
                <div className="audio-volume">
                    <button
                        onClick={handleToggleMute}
                        className="audio-btn-volume"
                        title={isMuted ? 'Unmute' : 'Mute'}
                    >
                        <VolumeIcon size={18} />
                    </button>
                    <div className="audio-volume-track">
                        <div
                            className="audio-volume-fill"
                            style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
                        />
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={isMuted ? 0 : volume}
                            onChange={handleVolumeChange}
                            className="audio-volume-input"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
