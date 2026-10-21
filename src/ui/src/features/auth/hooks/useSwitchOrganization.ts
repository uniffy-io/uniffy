import { createElement, useCallback, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { switchOrganization } from "@/features/auth/store/organizationsThunks";
import type { RecordingState } from "@/features/recording/store/recordingSlice";
import { cancelRecording } from "@/features/recording/store/recordingThunks";

// Switching orgs orphans the MultipartUpload row that backs an active recording, losing the clip.
const RECORDING_ACTIVE_STATES = new Set<RecordingState>([
  "requesting",
  "initiating-upload",
  "recording",
  "paused",
  "stopping",
  "flushing",
  "completing",
]);

interface PendingSwitch {
  slug: string;
  target?: string;
}

export interface OrganizationSwitchControls {
  /** Lands on `target` (default `/`) in the organization; the current one only navigates. */
  requestSwitch: (slug: string, target?: string) => Promise<void>;
  isSwitching: boolean;
  /** Recording discard confirmation; mount it where it outlives the menu that asked. */
  confirmDialog: ReactNode;
}

export function useSwitchOrganization(): OrganizationSwitchControls {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const here = location.pathname + location.search + location.hash;
  const recordingState = useAppSelector((state) => state.recording.state);
  const currentSlug = useAppSelector((state) => state.auth.currentOrganizationSlug);
  const isSwitching = useAppSelector((state) => state.organizations.switchingSlug !== null);
  const [pending, setPending] = useState<PendingSwitch | null>(null);

  const performSwitch = useCallback(
    async (slug: string, target?: string) => {
      try {
        await dispatch(switchOrganization(slug));
      } catch {
        // The rejected switch already went through the global error toast.
        return;
      }
      // Reopening the page the user is already on must not stack a second history entry.
      const destination = target ?? "/";
      navigate(destination, { replace: destination === here });
    },
    [dispatch, here, navigate],
  );

  const requestSwitch = useCallback(
    async (slug: string, target?: string) => {
      if (isSwitching) return;
      if (slug === currentSlug) {
        navigate(target ?? "/");
        return;
      }
      if (RECORDING_ACTIVE_STATES.has(recordingState)) {
        setPending({ slug, target });
        return;
      }
      await performSwitch(slug, target);
    },
    [currentSlug, isSwitching, navigate, performSwitch, recordingState],
  );

  const confirmDiscardAndSwitch = async () => {
    if (!pending) return;
    const { slug, target } = pending;
    setPending(null);
    await dispatch(cancelRecording());
    await performSwitch(slug, target);
  };

  const confirmDialog = createElement(ConfirmDialog, {
    isOpen: pending !== null,
    onClose: () => setPending(null),
    onConfirm: () => void confirmDiscardAndSwitch(),
    title: "Discard active recording?",
    message: "A screen recording is in progress. Switching organizations will discard it.",
    confirmLabel: "Discard and switch",
    cancelLabel: "Stay",
    variant: "warning",
  });

  return { requestSwitch, isSwitching, confirmDialog };
}
