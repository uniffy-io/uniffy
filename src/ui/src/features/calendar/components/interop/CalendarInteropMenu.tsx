import { useRef, useState } from "react";
import { DotsThreeVertical, DownloadSimple, Rss, UploadSimple } from "@phosphor-icons/react";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { Modal, ModalBody, ModalHeader } from "@/components/ui/modal";
import { useAppDispatch } from "@/app/hooks";
import { exportCalendar } from "@/features/calendar/store/calendarThunks";
import { CalendarFeedPanel } from "@/features/calendar/components/interop/CalendarFeedPanel";
import { ImportCalendarModal } from "@/features/calendar/components/interop/ImportCalendarModal";

/**
 * Calendar-level interop: take the calendar elsewhere, bring a file in, or keep
 * another calendar in sync with it.
 */
export function CalendarInteropMenu() {
  const dispatch = useAppDispatch();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="p-1.5 rounded-md hover:bg-muted transition-colors shrink-0"
        aria-label="Calendar options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <DotsThreeVertical size={16} weight="bold" className="text-muted-foreground" />
      </button>

      <ActionMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        triggerRef={triggerRef}
        label="Calendar options"
        align="right"
      >
        <ActionMenuItem
          onClick={() => {
            setMenuOpen(false);
            void dispatch(exportCalendar(undefined));
          }}
        >
          <DownloadSimple size={16} weight="duotone" />
          Export as .ics
        </ActionMenuItem>
        <ActionMenuItem
          onClick={() => {
            setMenuOpen(false);
            setImporting(true);
          }}
        >
          <UploadSimple size={16} weight="duotone" />
          Import a .ics file
        </ActionMenuItem>
        <ActionMenuSeparator />
        <ActionMenuItem
          onClick={() => {
            setMenuOpen(false);
            setSubscribing(true);
          }}
        >
          <Rss size={16} weight="duotone" />
          Get subscribe link
        </ActionMenuItem>
      </ActionMenu>

      {importing && <ImportCalendarModal onClose={() => setImporting(false)} />}

      {subscribing && (
        <Modal onClose={() => setSubscribing(false)} maxWidth="max-w-xl">
          <ModalHeader title="Subscribe from elsewhere" onClose={() => setSubscribing(false)} />
          <ModalBody>
            <CalendarFeedPanel />
          </ModalBody>
        </Modal>
      )}
    </>
  );
}
