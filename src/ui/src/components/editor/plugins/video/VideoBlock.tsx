// `src` starting with `uploading:` renders the in-progress placeholder; `/api/media/` URLs serve ranged bytes for seeking.

import { useEffect, useRef } from 'react';
import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import 'video.js/dist/video-js.css';
import '@/features/files/styles/videojs-uniffy.css';
import { VideoCamera } from '@phosphor-icons/react';

interface VideoBlockProps {
    src: string;
    title?: string;
    selected?: boolean;
}

export function VideoBlock({ src, title, selected }: VideoBlockProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<Player | null>(null);

    const isUploading = src.startsWith('uploading:');

    // Initialize Video.js player
    useEffect(() => {
        if (isUploading || !src || !containerRef.current) return;

        const videoElement = document.createElement('video-js');
        videoElement.classList.add('vjs-big-play-centered', 'vjs-fluid');
        containerRef.current.appendChild(videoElement);

        const player = videojs(videoElement, {
            controls: true,
            autoplay: false,
            preload: 'metadata',
            fluid: true,
            sources: [{ src, type: 'video/mp4' }],
        });

        playerRef.current = player;

        return () => {
            if (playerRef.current) {
                playerRef.current.dispose();
                playerRef.current = null;
            }
        };
    }, [src, isUploading]);

    if (isUploading) {
        return (
            <div className={`video-block-container video-block-uploading${selected ? ' video-block-selected' : ''}`}>
                <div className="video-block-uploading-content">
                    <svg
                        className="video-block-spinner"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeOpacity="0.25"
                            strokeWidth="3"
                        />
                        <path
                            d="M12 2a10 10 0 0 1 10 10"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                        />
                    </svg>
                    <span>Uploading video...</span>
                </div>
            </div>
        );
    }

    if (!src) {
        return (
            <div className="video-block-empty">
                No video source
            </div>
        );
    }

    return (
        <div className={`video-block-container${selected ? ' video-block-selected' : ''}`}>
            {title && (
                <div className="video-block-header">
                    <VideoCamera size={14} weight="bold" />
                    <span className="video-block-header-title">{title}</span>
                </div>
            )}
            <div
                ref={containerRef}
                className="video-block-player-wrapper"
                data-vjs-player
            />
        </div>
    );
}
