import { useRef, useState } from "react";
import {
  ArrowsClockwise,
  DotsThreeVertical,
  DownloadSimple,
  GearSix,
  LinkBreak,
  LinkSimple,
  Pause,
  PencilSimple,
  Play,
  PlugsConnected,
  Rss,
  ShareNetwork,
  Trash,
  UploadSimple,
  Warning,
} from "@phosphor-icons/react";
import { AccessMode, ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal, ModalBody, ModalHeader } from "@/components/ui/modal";
import { useAccessPolicyDialog } from "@/features/permissions";
import { CalendarFormModal } from "@/features/calendar/components/calendars/CalendarFormModal";
import { DeleteCalendarDialog } from "@/features/calendar/components/calendars/DeleteCalendarDialog";
import { CalendarFeedPanel } from "@/features/calendar/components/interop/CalendarFeedPanel";
import { ImportCalendarModal } from "@/features/calendar/components/interop/ImportCalendarModal";
import { ConnectAccountMenu } from "@/features/calendar/components/connections/ConnectAccountMenu";
import { ConnectionStatus } from "@/features/calendar/components/connections/ConnectionStatus";
import { DisconnectAccountDialog } from "@/features/calendar/components/connections/DisconnectAccountDialog";
import { ProviderMark } from "@/features/calendar/components/connections/ProviderMark";
import { useConnectAccount } from "@/features/calendar/hooks/useConnectAccount";
import { openConnectionsDialog } from "@/features/calendar/store/calendarConnectionsSlice";
import {
  pauseCalendarConnection,
  resumeCalendarConnection,
  syncCalendarConnectionNow,
} from "@/features/calendar/store/calendarConnectionsThunks";
import { needsAttention } from "@/features/calendar/utils/connectionCopy";
import { SubscribeCalendarModal } from "@/features/calendar/components/subscriptions/SubscribeCalendarModal";
import { SubscriptionStatus } from "@/features/calendar/components/subscriptions/SubscriptionStatus";
import {
  SidebarSection,
  SidebarSectionAdd,
} from "@/features/calendar/components/sidebar/SidebarSection";
import { useCalendarLabel, useCalendars } from "@/features/calendar/hooks/useCalendars";
import {
  deleteCalendar,
  refreshCalendarSubscription,
  setCalendarVisibility,
} from "@/features/calendar/store";
import { exportCalendar } from "@/features/calendar/store/calendarThunks";
import type { CalendarInfo, CalendarSection } from "@/features/calendar/types";
import { sidebarSections } from "@/features/calendar/utils/sidebarSections";
import { roleCanDelete, roleCanEdit, roleCanManage } from "@/shared/utils/contentRoles";
import { cn } from "@/shared/utils/cn";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";

type RowDialog =
  | "edit"
  | "delete"
  | "import"
  | "feed-link"
  | "edit-feed"
  | "unsubscribe"
  | "disconnect";

type Dialog = { kind: "create" | "follow-feed" } | { kind: RowDialog; calendar: CalendarInfo };

export function CalendarList() {
  const dispatch = useAppDispatch();
  const calendars = useCalendars();
  const labelOf = useCalendarLabel();
  const policy = useAppSelector((state) => state.calendar.calendarPolicy);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  const sectionAction = (section: CalendarSection) => {
    if (section === "mine") {
      return (
        <SidebarSectionAdd label="New calendar" onClick={() => setDialog({ kind: "create" })} />
      );
    }
    if (section === "subscribed" && policy?.canSubscribeExternalCalendars) {
      return (
        <SidebarSectionAdd
          label="Subscribe to a calendar"
          onClick={() => setDialog({ kind: "follow-feed" })}
        />
      );
    }
    if (section === "connected" && policy?.canConnectProviders) {
      return <ConnectAccountMenu />;
    }
    return undefined;
  };

  return (
    <>
      {sidebarSections(calendars, policy).map(({ section, id, title, rows }) => (
        <SidebarSection key={id} id={id} title={title} action={sectionAction(section)}>
          {rows.map((calendar) => (
            <CalendarRow
              key={calendar.id}
              calendar={calendar}
              onOpen={(kind) => setDialog({ kind, calendar })}
            />
          ))}
        </SidebarSection>
      ))}

      <Button
        type="button"
        variant="ghost"
        className="w-full justify-start"
        onClick={() => dispatch(openConnectionsDialog())}
      >
        <PlugsConnected size={16} />
        Manage connected accounts
      </Button>

      {dialog?.kind === "create" && <CalendarFormModal onClose={close} />}
      {dialog?.kind === "follow-feed" && <SubscribeCalendarModal onClose={close} />}
      {dialog?.kind === "edit-feed" && (
        <SubscribeCalendarModal calendar={dialog.calendar} onClose={close} />
      )}
      {dialog?.kind === "unsubscribe" && (
        <ConfirmDialog
          isOpen
          onClose={close}
          title={`Unsubscribe from ${labelOf(dialog.calendar)}?`}
          message="Its events disappear from Uniffy. The calendar at its source is not changed."
          confirmLabel="Unsubscribe"
          variant="danger"
          onConfirm={async () => {
            const outcome = await dispatch(
              deleteCalendar({ calendarId: dialog.calendar.id, disposition: "delete" }),
            );
            if (deleteCalendar.fulfilled.match(outcome)) close();
          }}
        />
      )}
      {dialog?.kind === "disconnect" && dialog.calendar.connection && (
        <DisconnectAccountDialog
          connectionId={dialog.calendar.connection.connectionId}
          provider={dialog.calendar.connection.provider}
          accountEmail={dialog.calendar.connection.accountEmail}
          onClose={close}
        />
      )}
      {dialog?.kind === "edit" && <CalendarFormModal calendar={dialog.calendar} onClose={close} />}
      {dialog?.kind === "delete" && (
        <DeleteCalendarDialog calendar={dialog.calendar} onClose={close} />
      )}
      {dialog?.kind === "import" && (
        <ImportCalendarModal calendarId={dialog.calendar.id} onClose={close} />
      )}
      {dialog?.kind === "feed-link" && (
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
  onOpen: (kind: RowDialog) => void;
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

  const feed = calendar.subscription;
  const connection = calendar.connection;
  const broken = feed?.state === "broken" || (!!connection && needsAttention(connection.state));

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md text-sm transition-colors",
          hidden ? "text-subtle-foreground" : "text-foreground",
          "hover:bg-muted",
        )}
        data-testid={
          connection
            ? "connected-calendar-row"
            : calendar.isReadOnly
              ? "subscribed-calendar-row"
              : undefined
        }
      >
        <button
          type="button"
          onClick={toggleVisibility}
          className="focus-ring min-h-11 flex flex-1 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left"
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
          {connection && <ProviderMark provider={connection.provider} size={12} />}
          <span className="truncate">{label}</span>
          {broken && (
            <Warning
              size={14}
              weight="fill"
              className="shrink-0 text-yellow-800 dark:text-yellow-400"
              aria-label={
                connection ? "This calendar needs attention" : "This calendar stopped updating"
              }
              data-testid={connection ? "connection-broken-badge" : "subscription-broken-badge"}
            />
          )}
        </button>

        <span className="flex shrink-0 items-center md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="focus-ring min-w-11 min-h-11 flex items-center justify-center rounded hover:bg-background/60"
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
          {connection ? (
            <ConnectedMenuItems calendar={calendar} pick={pick} onOpen={onOpen} />
          ) : calendar.isReadOnly ? (
            <ReadOnlyMenuItems calendar={calendar} pick={pick} onOpen={onOpen} />
          ) : (
            <WritableMenuItems
              calendar={calendar}
              canEdit={canEdit}
              canManage={canManage}
              canDelete={canDelete}
              pick={pick}
              onOpen={onOpen}
              openAccess={openAccess}
            />
          )}
        </ActionMenu>
      </div>
      <SubscriptionStatus calendar={calendar} />
      <ConnectionStatus calendar={calendar} />
    </div>
  );
}

interface MenuItemsProps {
  calendar: CalendarInfo;
  pick: (action: () => void) => () => void;
  onOpen: (kind: RowDialog) => void;
}

function ReadOnlyMenuItems({ calendar, pick, onOpen }: MenuItemsProps) {
  const dispatch = useAppDispatch();
  const feed = calendar.subscription;
  return (
    <>
      {feed && (
        <p className="px-3 pt-1 pb-2 text-xs text-subtle-foreground">
          <LinkSimple size={12} className="mr-1 inline" />
          {feed.urlHost}
          {feed.lastSuccessAt && <> · updated {formatRelativeTime(feed.lastSuccessAt)}</>}
        </p>
      )}
      {feed && (
        <>
          <ActionMenuItem onClick={pick(() => onOpen("edit-feed"))}>
            <PencilSimple size={16} weight="duotone" />
            Edit subscription
          </ActionMenuItem>
          <ActionMenuItem
            onClick={pick(() => void dispatch(refreshCalendarSubscription(calendar.id)))}
          >
            <ArrowsClockwise size={16} weight="duotone" />
            Refresh now
          </ActionMenuItem>
        </>
      )}
      <ActionMenuItem
        onClick={pick(() => void dispatch(exportCalendar({ calendarId: calendar.id })))}
      >
        <DownloadSimple size={16} weight="duotone" />
        Export as .ics
      </ActionMenuItem>
      {feed && (
        <>
          <ActionMenuSeparator />
          <ActionMenuItem destructive onClick={pick(() => onOpen("unsubscribe"))}>
            <Trash size={16} weight="duotone" />
            Unsubscribe
          </ActionMenuItem>
        </>
      )}
    </>
  );
}

function ConnectedMenuItems({ calendar, pick, onOpen }: MenuItemsProps) {
  const dispatch = useAppDispatch();
  const { connect } = useConnectAccount();
  const connection = calendar.connection;
  if (!connection) return null;
  const provider = connection.provider;
  const openSettings = () => dispatch(openConnectionsDialog(connection.connectionId));
  return (
    <>
      <p className="px-3 pt-1 pb-2 text-xs text-subtle-foreground">
        {connection.accountEmail}
        {connection.lastSuccessAt && <> · synced {formatRelativeTime(connection.lastSuccessAt)}</>}
      </p>
      {connection.state === "reauth_required" && provider ? (
        <ActionMenuItem onClick={pick(() => void connect(provider, connection.connectionId))}>
          <PlugsConnected size={16} weight="duotone" />
          Reconnect
        </ActionMenuItem>
      ) : (
        <ActionMenuItem
          disabled={connection.state === "paused"}
          onClick={pick(() => void dispatch(syncCalendarConnectionNow(connection.connectionId)))}
        >
          <ArrowsClockwise size={16} weight="duotone" />
          Sync now
        </ActionMenuItem>
      )}
      <ActionMenuItem onClick={pick(openSettings)}>
        <GearSix size={16} weight="duotone" />
        Settings
      </ActionMenuItem>
      {connection.state === "paused" ? (
        <ActionMenuItem
          onClick={pick(() => void dispatch(resumeCalendarConnection(connection.connectionId)))}
        >
          <Play size={16} weight="duotone" />
          Resume account sync
        </ActionMenuItem>
      ) : (
        connection.state !== "reauth_required" && (
          <ActionMenuItem
            onClick={pick(() => void dispatch(pauseCalendarConnection(connection.connectionId)))}
          >
            <Pause size={16} weight="duotone" />
            Pause account sync
          </ActionMenuItem>
        )
      )}
      <ActionMenuItem
        onClick={pick(() => void dispatch(exportCalendar({ calendarId: calendar.id })))}
      >
        <DownloadSimple size={16} weight="duotone" />
        Export as .ics
      </ActionMenuItem>
      <ActionMenuSeparator />
      <ActionMenuItem destructive onClick={pick(() => onOpen("disconnect"))}>
        <LinkBreak size={16} weight="duotone" />
        Disconnect account
      </ActionMenuItem>
    </>
  );
}

function WritableMenuItems({
  calendar,
  canEdit,
  canManage,
  canDelete,
  pick,
  onOpen,
  openAccess,
}: MenuItemsProps & {
  canEdit: boolean;
  canManage: boolean;
  canDelete: boolean;
  openAccess: () => void;
}) {
  const dispatch = useAppDispatch();
  return (
    <>
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
      <ActionMenuItem onClick={pick(() => onOpen("feed-link"))}>
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
    </>
  );
}
