import { useRef, useState } from "react";
import {
  DotsThreeVertical,
  DownloadSimple,
  Eye,
  EyeSlash,
  PencilSimple,
  Plus,
  Rss,
  ShareNetwork,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { AccessMode, ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { Modal, ModalBody, ModalHeader } from "@/components/ui/modal";
import { useAccessPolicyDialog } from "@/features/permissions";
import { CalendarFormModal } from "@/features/calendar/components/calendars/CalendarFormModal";
import { DeleteCalendarDialog } from "@/features/calendar/components/calendars/DeleteCalendarDialog";
import { CalendarFeedPanel } from "@/features/calendar/components/interop/CalendarFeedPanel";
import { ImportCalendarModal } from "@/features/calendar/components/interop/ImportCalendarModal";
import { SidebarSection } from "@/features/calendar/components/sidebar/SidebarSection";
import { useCalendarLabel, useCalendars } from "@/features/calendar/hooks/useCalendars";
import { setCalendarVisibility } from "@/features/calendar/store";
import { exportCalendar } from "@/features/calendar/store/calendarThunks";
import type { CalendarInfo, CalendarSection, SidebarSectionId } from "@/features/calendar/types";
import { roleCanDelete, roleCanEdit, roleCanManage } from "@/shared/utils/contentRoles";
import { cn } from "@/shared/utils/cn";

type Dialog =
  | { kind: "create" }
  | { kind: "edit" | "delete" | "import" | "subscribe"; calendar: CalendarInfo };

const SECTIONS: { section: CalendarSection; id: SidebarSectionId; title: string }[] = [
  { section: "mine", id: "calendars", title: "My calendars" },
  { section: "shared", id: "shared_calendars", title: "Shared with me" },
  { section: "organization", id: "organization", title: "Organization" },
];

export function CalendarList() {
  const calendars = useCalendars();
  const labelOf = useCalendarLabel();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  return (
    <>
      {SECTIONS.map(({ section, id, title }) => {
        const rows = calendars.filter((calendar) => calendar.section === section);
        // "Mine" always shows, so there is somewhere to create the first calendar.
        if (rows.length === 0 && section !== "mine") return null;
        return (
          <SidebarSection
            key={id}
            id={id}
            title={title}
            action={
              section === "mine" ? (
                <button
                  type="button"
                  onClick={() => setDialog({ kind: "create" })}
                  className="focus-ring p-0.5 rounded hover:bg-muted"
                  title="New calendar"
                  aria-label="New calendar"
                >
                  <Plus size={14} weight="bold" className="text-muted-foreground" />
                </button>
              ) : undefined
            }
          >
            {rows.map((calendar) => (
              <CalendarRow
                key={calendar.id}
                calendar={calendar}
                onOpen={(kind) => setDialog({ kind, calendar })}
              />
            ))}
          </SidebarSection>
        );
      })}

      {dialog?.kind === "create" && <CalendarFormModal onClose={close} />}
      {dialog?.kind === "edit" && <CalendarFormModal calendar={dialog.calendar} onClose={close} />}
      {dialog?.kind === "delete" && (
        <DeleteCalendarDialog calendar={dialog.calendar} onClose={close} />
      )}
      {dialog?.kind === "import" && (
        <ImportCalendarModal calendarId={dialog.calendar.id} onClose={close} />
      )}
      {dialog?.kind === "subscribe" && (
        <Modal onClose={close} maxWidth="max-w-xl">
          <ModalHeader
            title="Subscribe from elsewhere"
            description={labelOf(dialog.calendar)}
            onClose={close}
          />
          <ModalBody>
            <CalendarFeedPanel calendarId={dialog.calendar.id} />
          </ModalBody>
        </Modal>
      )}
    </>
  );
}

interface CalendarRowProps {
  calendar: CalendarInfo;
  onOpen: (kind: "edit" | "delete" | "import" | "subscribe") => void;
}

function CalendarRow({ calendar, onOpen }: CalendarRowProps) {
  const dispatch = useAppDispatch();
  const policy = useAppSelector((state) => state.calendar.calendarPolicy);
  const { openFor: openAccessPolicyDialog } = useAccessPolicyDialog();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const canEdit = roleCanEdit(calendar.userRole);
  const canManage = roleCanManage(calendar.userRole);
  const canDelete = roleCanDelete(calendar.userRole) && !calendar.isDefault;
  const hidden = calendar.isHidden;
  const labelOf = useCalendarLabel();
  const label = labelOf(calendar);

  const toggleVisibility = () => {
    void dispatch(setCalendarVisibility({ calendarId: calendar.id, hidden: !hidden }));
  };

  const openAccess = () => {
    // Offer "whole organization" only where the org policy lets this member choose it.
    const hiddenModes =
      policy && !policy.canShareCalendarsOrgWide && calendar.accessMode !== AccessMode.OPEN_TO_ORG
        ? [AccessMode.OPEN_TO_ORG]
        : undefined;
    openAccessPolicyDialog(
      ContentType.CALENDAR,
      calendar.id,
      label,
      calendar.userRole || null,
      hiddenModes,
    );
  };

  const pick = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md text-sm transition-colors",
        hidden ? "text-subtle-foreground" : "text-foreground",
        "hover:bg-muted",
      )}
    >
      <button
        type="button"
        onClick={toggleVisibility}
        className="focus-ring flex flex-1 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left"
        aria-pressed={!hidden}
        title={hidden ? `Show ${label}` : `Hide ${label}`}
      >
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0 border-2 transition-colors"
          style={{
            backgroundColor: hidden ? "transparent" : calendar.color,
            borderColor: calendar.color,
          }}
        />
        <span className="truncate">{label}</span>
      </button>

      <span className="flex shrink-0 items-center md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
        {/* The row button is the accessible toggle; the eye repeats it for the pointer. */}
        <button
          type="button"
          onClick={toggleVisibility}
          tabIndex={-1}
          aria-hidden
          className="p-1 rounded text-muted-foreground hover:bg-background/60"
        >
          {hidden ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
        </button>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="focus-ring p-1 rounded hover:bg-background/60"
          aria-label={`${label} options`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <DotsThreeVertical size={14} weight="bold" className="text-muted-foreground" />
        </button>
      </span>

      <ActionMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        triggerRef={triggerRef}
        label={`${label} options`}
        align="right"
      >
        {canEdit && (
          <ActionMenuItem onClick={pick(() => onOpen("edit"))}>
            <PencilSimple size={16} weight="duotone" />
            Edit
          </ActionMenuItem>
        )}
        <ActionMenuItem onClick={pick(openAccess)}>
          <ShareNetwork size={16} weight="duotone" />
          {canManage ? "Share" : "Who has access"}
        </ActionMenuItem>
        <ActionMenuSeparator />
        <ActionMenuItem
          onClick={pick(() => void dispatch(exportCalendar({ calendarId: calendar.id })))}
        >
          <DownloadSimple size={16} weight="duotone" />
          Export as .ics
        </ActionMenuItem>
        {canEdit && (
          <ActionMenuItem onClick={pick(() => onOpen("import"))}>
            <UploadSimple size={16} weight="duotone" />
            Import a .ics file
          </ActionMenuItem>
        )}
        <ActionMenuItem onClick={pick(() => onOpen("subscribe"))}>
          <Rss size={16} weight="duotone" />
          Get subscribe link
        </ActionMenuItem>
        {canDelete && (
          <>
            <ActionMenuSeparator />
            <ActionMenuItem destructive onClick={pick(() => onOpen("delete"))}>
              <Trash size={16} weight="duotone" />
              Delete
            </ActionMenuItem>
          </>
        )}
      </ActionMenu>
    </div>
  );
}
