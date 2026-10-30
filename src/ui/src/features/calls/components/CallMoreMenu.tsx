import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowsIn,
  ArrowsOut,
  ArrowSquareOut,
  Check,
  DotsThree,
  GearSix,
  Monitor,
  PhoneDisconnect,
} from "@phosphor-icons/react";
import { ScreenShareQuality } from "@uniffy/proto/calls/v1/calls_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal, ModalBody, ModalHeader } from "@/components/ui/modal";
import { PortalMenu } from "@/components/ui/portal-menu";
import { cn } from "@/shared/utils/cn";
import { CallDeviceSettings } from "@/features/calls/components/CallDeviceSettings";
import { CallParticipation } from "@/features/calls/components/CallParticipation";
import {
  callControlActiveClass,
  callControlClass,
  callMenuItemClass,
} from "@/features/calls/components/controlChrome";
import { useCall } from "@/features/calls/components/callContext";
import { useCallModeration } from "@/features/calls/hooks/useCallModeration";
import { selectCallSession } from "@/features/calls/store/callsSlice";
import {
  screenShareQualitySelected,
  selectCallPreferences,
} from "@/features/calls/store/callPreferencesSlice";
import {
  SCREEN_SHARE_QUALITY_LABEL,
  selectableTiers,
} from "@/features/calls/utils/screenShareQuality";

export function CallMoreMenu({
  onToggleChat,
  chatOpen,
  onToggleFullscreen,
  isFullscreen,
}: {
  onToggleChat?: () => void;
  chatOpen?: boolean;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}) {
  const dispatch = useAppDispatch();
  const { openPopout, popoutWindow, closePopout, endCurrentCall } = useCall();
  const canModerate = useCallModeration();
  const session = useAppSelector(selectCallSession);
  const preferences = useAppSelector(selectCallPreferences);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ document: Document; mobile: boolean } | null>(null);
  const [page, setPage] = useState<"main" | "devices" | "quality">("main");
  const [confirmDocument, setConfirmDocument] = useState<Document | null>(null);
  const [ending, setEnding] = useState(false);
  const close = () => {
    setMenu(null);
    triggerRef.current?.focus();
  };
  useEffect(() => {
    if (page !== "main") contentRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [page]);
  const content = (
    <div ref={contentRef} className="p-1" aria-label="Call options">
      {page !== "main" && (
        <button type="button" className={callMenuItemClass} onClick={() => setPage("main")}>
          <ArrowLeft size={17} />
          Back
        </button>
      )}
      {page === "devices" && <CallDeviceSettings />}
      {page === "quality" && (
        <div>
          <p className="px-3 py-2 text-xs text-muted-foreground">Screen share quality</p>
          {[ScreenShareQuality.UNSPECIFIED, ...selectableTiers(session.screenShareQualityCap)].map(
            (tier) => (
              <button
                type="button"
                key={tier}
                className={callMenuItemClass}
                aria-pressed={preferences.screenShareQuality === tier}
                onClick={() => {
                  dispatch(screenShareQualitySelected(tier));
                  close();
                }}
              >
                <span className="w-4">
                  {preferences.screenShareQuality === tier && <Check size={16} />}
                </span>
                {SCREEN_SHARE_QUALITY_LABEL[tier]}
              </button>
            ),
          )}
        </div>
      )}
      {page === "main" && (
        <>
          <CallParticipation
            variant="menu"
            chatOpen={chatOpen}
            onToggleChat={
              onToggleChat
                ? () => {
                    onToggleChat();
                    close();
                  }
                : undefined
            }
          />
          <div className="my-1 border-t border-border/60" />
          <button type="button" className={callMenuItemClass} onClick={() => setPage("devices")}>
            <GearSix size={17} />
            Audio and camera settings
          </button>
          <button type="button" className={callMenuItemClass} onClick={() => setPage("quality")}>
            <Monitor size={17} />
            Screen share quality
          </button>
          <button
            type="button"
            className={callMenuItemClass}
            onClick={() => {
              close();
              if (popoutWindow) closePopout();
              else void openPopout();
            }}
          >
            <ArrowSquareOut size={17} />
            {popoutWindow ? "Return call to tab" : "Pop out"}
          </button>
          {onToggleFullscreen && (
            <button
              type="button"
              className={callMenuItemClass}
              onClick={() => {
                close();
                onToggleFullscreen();
              }}
            >
              {isFullscreen ? <ArrowsIn size={17} /> : <ArrowsOut size={17} />}
              {isFullscreen ? "Exit full screen" : "Full screen"}
            </button>
          )}
          {canModerate && (
            <>
              <div className="my-1 border-t border-border/60" />
              <button
                type="button"
                className={cn(callMenuItemClass, "text-destructive hover:bg-destructive/10")}
                data-testid="call-end-for-all-button"
                onClick={(event) => {
                  setConfirmDocument(event.currentTarget.ownerDocument);
                  close();
                }}
              >
                <PhoneDisconnect size={17} />
                End call for everyone
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="More call options"
        title="More call options"
        aria-expanded={!!menu}
        className={cn(callControlClass(), menu && callControlActiveClass)}
        onClick={(event) => {
          const document = event.currentTarget.ownerDocument;
          setPage("main");
          setMenu(
            menu ? null : { document, mobile: (document.defaultView?.innerWidth ?? 1024) < 768 },
          );
        }}
      >
        <DotsThree size={16} weight="bold" />
      </button>
      {menu?.mobile ? (
        <Modal ownerDocument={menu.document} onClose={close} maxWidth="max-w-sm">
          <ModalHeader title="Call options" onClose={close} />
          <ModalBody className="!p-2">{content}</ModalBody>
        </Modal>
      ) : (
        <PortalMenu
          open={!!menu}
          onClose={close}
          triggerRef={triggerRef}
          autoFocus
          className="w-72"
        >
          {content}
        </PortalMenu>
      )}
      <ConfirmDialog
        ownerDocument={confirmDocument ?? undefined}
        isOpen={!!confirmDocument}
        onClose={() => setConfirmDocument(null)}
        title="End call for everyone?"
        message="Everyone will be disconnected. To leave on your own, use Leave instead."
        confirmLabel="End call"
        loading={ending}
        onConfirm={async () => {
          setEnding(true);
          try {
            await endCurrentCall();
            setConfirmDocument(null);
          } finally {
            setEnding(false);
          }
        }}
      />
    </>
  );
}
