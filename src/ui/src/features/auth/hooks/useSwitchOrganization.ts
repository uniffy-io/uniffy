import { createElement, useCallback, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { selectCurrentOrganization } from "@/features/auth/store/organizationsSlice";
import { switchOrganization } from "@/features/auth/store/organizationsThunks";
import { uploadService } from "@/features/files/upload";
import { hasUnsyncedEdits } from "@/features/realtime";
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

/** What a switch would interrupt in this tab, asked once before it runs. */
interface SwitchInterruptions {
  recording: boolean;
  unsyncedEdits: boolean;
  uploads: boolean;
}

interface PendingSwitch {
  work: () => Promise<void>;
  interruptions: SwitchInterruptions;
}

export interface OrganizationSwitchControls {
  /** Lands on `target` (default `/`) in the organization; the current one only navigates. */
  requestSwitch: (slug: string, target?: string) => Promise<void>;
  /** Runs `work`, which moves this tab into another organization, once the same confirmation passes. */
  guardSwitch: (work: () => Promise<void>) => Promise<void>;
  isSwitching: boolean;
  /** Confirmation for work the switch would interrupt; mount it where it outlives the menu that asked. */
  confirmDialog: ReactNode;
}

function interruptionMessage(interruptions: SwitchInterruptions, organizationName: string): string {
  const parts: string[] = [];
  if (interruptions.recording) {
    parts.push("A screen recording is in progress. Switching organizations will discard it.");
  }
  if (interruptions.unsyncedEdits) {
    parts.push(
      `Some edits in ${organizationName} have not reached the server yet. They stay on this device and finish saving when a tab opens ${organizationName} again.`,
    );
  }
  if (interruptions.uploads) {
    parts.push("Switching cancels the uploads in progress in this tab.");
  }
  return parts.join(" ");
}

export function useSwitchOrganization(): OrganizationSwitchControls {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const here = location.pathname + location.search + location.hash;
  const recordingState = useAppSelector((state) => state.recording.state);
  const userId = useAppSelector((state) => state.auth.user?.id ?? null);
  const currentOrganizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const currentSlug = useAppSelector((state) => state.auth.currentOrganizationSlug);
  const currentOrganization = useAppSelector(selectCurrentOrganization);
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

  const guardSwitch = useCallback(
    async (work: () => Promise<void>) => {
      if (isSwitching) return;
      // Pending edits keep their rows and drain once a tab returns to this organization; only
      // this tab's uploads end with the switch.
      const interruptions: SwitchInterruptions = {
        recording: RECORDING_ACTIVE_STATES.has(recordingState),
        unsyncedEdits:
          currentOrganizationId !== null && hasUnsyncedEdits(userId, currentOrganizationId),
        uploads: uploadService.hasActiveUploads(),
      };
      if (interruptions.recording || interruptions.unsyncedEdits || interruptions.uploads) {
        setPending({ work, interruptions });
        return;
      }
      await work();
    },
    [currentOrganizationId, isSwitching, recordingState, userId],
  );

  const requestSwitch = useCallback(
    async (slug: string, target?: string) => {
      if (isSwitching) return;
      if (slug === currentSlug) {
        navigate(target ?? "/");
        return;
      }
      await guardSwitch(() => performSwitch(slug, target));
    },
    [currentSlug, guardSwitch, isSwitching, navigate, performSwitch],
  );

  const confirmSwitch = async () => {
    if (!pending) return;
    const { work, interruptions } = pending;
    setPending(null);
    if (interruptions.recording) await dispatch(cancelRecording());
    await work();
  };

  const recording = pending?.interruptions.recording ?? false;
  const confirmDialog = createElement(ConfirmDialog, {
    isOpen: pending !== null,
    onClose: () => setPending(null),
    onConfirm: () => void confirmSwitch(),
    title: recording ? "Discard active recording?" : "Wait or switch anyway?",
    message: pending
      ? interruptionMessage(pending.interruptions, currentOrganization?.name ?? "this organization")
      : "",
    confirmLabel: recording ? "Discard and switch" : "Switch anyway",
    cancelLabel: recording ? "Stay" : "Wait",
    variant: "warning",
  });

  return { requestSwitch, guardSwitch, isSwitching, confirmDialog };
}
