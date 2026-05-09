/**
 * One-time consent modal shown the first time a user starts a recording.
 *
 * Tells them in plain language that the recording will capture everything
 * visible on the chosen surface, including other apps, tabs, and any
 * sensitive data on screen. The browser's own picker is the second
 * confirmation (and is non-skippable), but a friendlier in-app explainer
 * up front avoids surprise: a user who mis-clicked "Entire screen" and
 * had a password manager open has time to back out.
 *
 * Continue dispatches `firstUseAcknowledged` (persisted) and re-dispatches
 * `startRecording`. Cancel just closes the modal.
 */

import { ShieldWarning, X } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Modal } from '@/components/ui/modal';
import {
    firstUseAcknowledged,
    firstUseModalClosed,
} from '@/features/recording/store/recordingSlice';
import { startRecording } from '@/features/recording/store/recordingThunks';

export function RecordingFirstUseModal() {
    const dispatch = useAppDispatch();
    const open = useAppSelector((state) => state.recording.firstUseModalOpen);

    if (!open) return null;

    const handleClose = () => {
        dispatch(firstUseModalClosed());
    };

    const handleContinue = () => {
        dispatch(firstUseAcknowledged());
        void dispatch(startRecording());
    };

    return (
        <Modal onClose={handleClose} maxWidth="max-w-md">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
                <div className="flex items-start gap-3">
                    <span
                        aria-hidden="true"
                        className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    >
                        <ShieldWarning size={18} weight="fill" />
                    </span>
                    <div>
                        <h2 className="text-base font-semibold text-foreground">
                            Before you record
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Quick heads-up about what gets captured.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={handleClose}
                    aria-label="Close"
                    className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                    <X size={14} weight="bold" />
                </button>
            </div>

            <div className="px-5 py-4 space-y-3 text-sm leading-relaxed text-foreground">
                <p>
                    Your recording will capture everything visible on the screen,
                    window, or tab you choose. That includes:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                    <li>Notifications, banners, and chat windows that appear during the clip.</li>
                    <li>Passwords or secrets briefly shown on screen.</li>
                    <li>Other people&apos;s names, photos, and email addresses.</li>
                </ul>
                <p className="text-muted-foreground">
                    Pause or stop any time. The clip lands in your private
                    <span className="font-medium text-foreground"> Recordings </span>
                    folder; you can share or delete it later.
                </p>
            </div>

            <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted-foreground/70">
                    This message only shows once.
                </p>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleClose}
                        className="inline-flex items-center rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleContinue}
                        className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                        Continue
                    </button>
                </div>
            </div>
        </Modal>
    );
}
