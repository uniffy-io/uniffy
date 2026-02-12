/**
 * AudioBlock Component
 *
 * Renders an inline audio player within the notes editor.
 * Uses a plain <canvas> for waveform visualization (bypasses WaveSurfer shadow DOM
 * which does not render inside ProseMirror node views) and a standard <audio>
 * element for playback via service worker streaming.
 *
 * Shows an animated uploading indicator when src starts with "uploading:".
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause } from '@phosphor-icons/react';

interface AudioBlockProps {
    src: string;
    title?: string;
    selected?: boolean;
}

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const BAR_RADIUS = 1;
const CANVAS_HEIGHT = 32;

function formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Resolve CSS --primary HSL value to rgb components. */
function resolvePrimaryRgb(): { r: number; g: number; b: number } {
    const hsl = getComputedStyle(document.documentElement)
        .getPropertyValue('--primary')
        .trim();
    if (!hsl) return { r: 124, g: 58, b: 237 };

    const temp = document.createElement('div');
    temp.style.color = `hsl(${hsl})`;
    temp.style.display = 'none';
    document.body.appendChild(temp);
    const computed = getComputedStyle(temp).color;
    document.body.removeChild(temp);

    const m = computed.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    return { r: 124, g: 58, b: 237 };
}

/** Extract normalised peak amplitudes from decoded audio. */
function extractPeaks(audioBuffer: AudioBuffer, numBars: number): Float32Array {
    const channel = audioBuffer.getChannelData(0);
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
    return peaks;
}

/** Draw waveform bars onto a canvas with a progress split colour. */
function drawWaveform(
    canvas: HTMLCanvasElement,
    peaks: Float32Array,
    progress: number,
    rgb: { r: number; g: number; b: number },
) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;

    // Resize backing store only when needed
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const totalBar = BAR_WIDTH + BAR_GAP;
    const numBars = Math.min(peaks.length, Math.floor(cssW / totalBar));
    const { r, g, b } = rgb;
    const played = `rgba(${r},${g},${b},0.9)`;
    const unplayed = `rgba(${r},${g},${b},0.35)`;

    for (let i = 0; i < numBars; i++) {
        const x = i * totalBar;
        const h = Math.max(1, peaks[i] * cssH * 0.9);
        const y = (cssH - h) / 2;
        ctx.fillStyle = i / numBars < progress ? played : unplayed;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_WIDTH, h, BAR_RADIUS);
        ctx.fill();
    }
}

export function AudioBlock({ src, selected }: AudioBlockProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const peaksRef = useRef<Float32Array>(new Float32Array(0));
    const blobUrlRef = useRef<string | null>(null);
    const rafRef = useRef(0);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isReady, setIsReady] = useState(false);

    const isUploading = src.startsWith('uploading:');

    const [rgb] = useState(resolvePrimaryRgb);

    // ----- Load audio, decode peaks, set up <audio> element -----
    useEffect(() => {
        if (isUploading || !src) return;

        const ac = new AbortController();
        let audioCtx: AudioContext | null = null;
        let blobUrl: string | null = null;

        const loadUrl = src.includes('?') ? `${src}&full=true` : `${src}?full=true`;

        (async () => {
            try {
                const res = await fetch(loadUrl, { signal: ac.signal });
                const arrayBuffer = await res.arrayBuffer();

                // Blob for <audio> playback
                const blob = new Blob([arrayBuffer], { type: res.headers.get('content-type') || 'audio/mpeg' });
                blobUrl = URL.createObjectURL(blob);
                blobUrlRef.current = blobUrl;

                if (audioRef.current) {
                    audioRef.current.src = blobUrl;
                }

                // Decode for waveform peaks (clone buffer since decode may detach)
                audioCtx = new AudioContext();
                const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
                const canvas = canvasRef.current;
                const numBars = canvas ? Math.floor(canvas.clientWidth / (BAR_WIDTH + BAR_GAP)) : 300;
                peaksRef.current = extractPeaks(decoded, numBars);

                setDuration(decoded.duration);
                setIsReady(true);

                if (canvas) {
                    drawWaveform(canvas, peaksRef.current, 0, rgb);
                }
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                console.error('[AudioBlock] load error:', err);
            }
        })();

        return () => {
            ac.abort();
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            blobUrlRef.current = null;
            audioCtx?.close();
        };
    }, [src, isUploading, rgb]);

    // ----- Animation loop: sync waveform progress with playback -----
    useEffect(() => {
        if (!isPlaying || !isReady) return;

        function tick() {
            const audio = audioRef.current;
            const canvas = canvasRef.current;
            if (audio && canvas && peaksRef.current.length) {
                const progress = audio.duration ? audio.currentTime / audio.duration : 0;
                setCurrentTime(audio.currentTime);
                drawWaveform(canvas, peaksRef.current, progress, rgb);
            }
            rafRef.current = requestAnimationFrame(tick);
        }
        rafRef.current = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(rafRef.current);
    }, [isPlaying, isReady, rgb]);

    // ----- Redraw on resize -----
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ro = new ResizeObserver(() => {
            if (peaksRef.current.length) {
                const progress = audioRef.current?.duration
                    ? audioRef.current.currentTime / audioRef.current.duration
                    : 0;
                drawWaveform(canvas, peaksRef.current, progress, rgb);
            }
        });
        ro.observe(canvas);
        return () => ro.disconnect();
    }, [rgb]);

    // ----- Audio element event wiring -----
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onEnded = () => {
            setIsPlaying(false);
            setCurrentTime(0);
            if (canvasRef.current && peaksRef.current.length) {
                drawWaveform(canvasRef.current, peaksRef.current, 0, rgb);
            }
        };
        const onTimeUpdate = () => {
            if (!isPlaying) setCurrentTime(audio.currentTime);
        };

        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('timeupdate', onTimeUpdate);

        return () => {
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('timeupdate', onTimeUpdate);
        };
    }, [isPlaying, rgb]);

    // ----- Handlers -----
    const handlePlayPause = useCallback(() => {
        const audio = audioRef.current;
        if (!audio || !isReady) return;
        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    }, [isReady]);

    const handleCanvasClick = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            const audio = audioRef.current;
            const canvas = canvasRef.current;
            if (!audio || !canvas || !isReady) return;

            const rect = canvas.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            audio.currentTime = ratio * audio.duration;
            setCurrentTime(audio.currentTime);
            drawWaveform(canvas, peaksRef.current, ratio, rgb);
        },
        [isReady, rgb],
    );

    // ----- Render -----
    if (isUploading) {
        return (
            <div className={`audio-block-container audio-block-uploading${selected ? ' audio-block-selected' : ''}`}>
                <div className="audio-block-uploading-content">
                    <svg
                        className="audio-block-spinner"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    <span>Uploading audio...</span>
                </div>
            </div>
        );
    }

    if (!src) {
        return <div className="audio-block-empty">No audio source</div>;
    }

    return (
        <div className={`audio-block-container${selected ? ' audio-block-selected' : ''}`}>
            {/* Hidden audio element for playback */}
            <audio ref={audioRef} preload="none" style={{ display: 'none' }} />

            <div className="audio-block-controls">
                <button
                    className="audio-block-play-btn"
                    onClick={handlePlayPause}
                    title={isPlaying ? 'Pause' : 'Play'}
                    disabled={!isReady}
                >
                    {isPlaying ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
                </button>

                <div className="audio-block-waveform-wrapper">
                    <canvas
                        ref={canvasRef}
                        className="audio-block-waveform"
                        style={{ width: '100%', height: CANVAS_HEIGHT, cursor: isReady ? 'pointer' : 'default' }}
                        onClick={handleCanvasClick}
                    />
                </div>

                <span className="audio-block-time">
                    {formatTime(currentTime)} / {formatTime(duration)}
                </span>
            </div>
        </div>
    );
}
