import { useState } from "react";
import {
  MapPin,
  Door,
  Users,
  VideoCamera,
  Link as LinkIcon,
  Prohibit,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { openRoomViewer } from "@/features/rooms/store/roomsThunks";
import { RoomPicker } from "@/features/rooms/components/shared/RoomPicker";
import { MeetingChannelPicker } from "@/features/calendar/components/modals/MeetingChannelPicker";
import { EventMeetingJoin } from "@/features/calendar/components/layout/EventMeetingJoin";
import { InlineTextField } from "@/features/calendar/components/detail/InlineTextField";
import { SectionLabel } from "@/features/calendar/components/detail/SectionLabel";
import { resolveMeetingSubmit, type MeetingMode } from "@/features/calendar/utils/meeting";
import type { CalendarEvent } from "@/features/calendar/types";
import type { EventPatch } from "@/features/calendar/hooks/useEventCommit";

const MEETING_MODES: { mode: MeetingMode; icon: typeof VideoCamera; label: string }[] = [
  { mode: "none", icon: Prohibit, label: "None" },
  { mode: "link", icon: LinkIcon, label: "Link" },
  { mode: "channel", icon: VideoCamera, label: "Uniffy" },
];

interface EventPlaceSectionProps {
  event: CalendarEvent;
  canEdit: boolean;
  commit: (patch: EventPatch) => void;
}

export function EventPlaceSection({ event, canEdit, commit }: EventPlaceSectionProps) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const storedMode: MeetingMode = event.channelId ? "channel" : event.meetingUrl ? "link" : "none";

  // "link with no URL yet" and "channel with none picked yet" have no server representation,
  // so the selected mode is local and only the payload (URL / channel) is persisted.
  const [meetingMode, setMeetingMode] = useState<MeetingMode>(storedMode);
  const [modeEventId, setModeEventId] = useState(event.id);
  if (modeEventId !== event.id) {
    setModeEventId(event.id);
    setMeetingMode(storedMode);
  }

  const commitMeetingMode = (mode: MeetingMode) => {
    if (mode === meetingMode) return;
    setMeetingMode(mode);

    // Only write when the switch actually drops an existing binding; adopting a new one
    // waits for the URL or the channel pick.
    const dropsBinding =
      mode === "none" ||
      (mode === "link" && !!event.channelId) ||
      (mode === "channel" && !!event.meetingUrl);
    if (!dropsBinding) return;

    const { meetingUrl, channelId } = resolveMeetingSubmit(mode, null, "", event.channelId);
    commit({ meetingUrl, channelId, channelAutoCreated: false });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <MapPin size={16} weight="duotone" className="text-muted-foreground shrink-0" />
        <InlineTextField
          value={event.location}
          onCommit={(location) => commit({ location })}
          placeholder="Add location"
          readOnly={!canEdit}
          className="flex-1 min-w-0"
        />
      </div>

      {event.channelId && <EventMeetingJoin channelId={event.channelId} />}

      {canEdit && (
        <div>
          <SectionLabel>Online meeting</SectionLabel>
          <div className="flex gap-1 p-0.5 bg-muted/50 rounded-lg">
            {MEETING_MODES.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => commitMeetingMode(mode)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-md",
                  "text-xs font-medium whitespace-nowrap transition-all",
                  meetingMode === mode
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                <Icon
                  size={13}
                  weight={meetingMode === mode ? "fill" : "duotone"}
                  className="shrink-0"
                />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {meetingMode === "link" && (
            <InlineTextField
              value={event.meetingUrl ?? ""}
              onCommit={(meetingUrl) => commit({ meetingUrl })}
              placeholder="https://..."
              type="url"
            />
          )}

          {meetingMode === "channel" && (
            <MeetingChannelPicker
              selectedChannelId={event.channelId ?? null}
              onSelect={(id) => commit({ channelId: id ?? "", channelAutoCreated: false })}
              onCreateRoom={(id) => commit({ channelId: id, channelAutoCreated: true })}
              attendeeIds={event.attendees.map((a) => a.id)}
              eventTitle={event.title}
            />
          )}
        </div>
      )}

      {canEdit && organizationId ? (
        <div>
          <SectionLabel>Room</SectionLabel>
          <RoomPicker
            selectedRoomId={event.roomId ?? null}
            onSelect={(roomId) => commit({ roomId: roomId ?? "" })}
            organizationId={organizationId}
            startTime={event.startTime}
            endTime={event.endTime}
          />
        </div>
      ) : (
        event.roomName && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Door size={16} weight="duotone" className="text-muted-foreground" />
              {event.roomId ? (
                <button
                  type="button"
                  onClick={() => dispatch(openRoomViewer({ roomId: event.roomId! }))}
                  className="text-sm font-medium text-foreground hover:text-primary transition-colors text-left"
                  title="View room details"
                >
                  {event.roomName}
                </button>
              ) : (
                <span className="text-sm font-medium text-foreground">{event.roomName}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pl-6">
              {event.roomLocation && (
                <span className="flex items-center gap-1">
                  <MapPin size={12} />
                  {event.roomLocation}
                </span>
              )}
              {event.roomCapacity && event.roomCapacity > 0 && (
                <span className="flex items-center gap-1">
                  <Users size={12} />
                  {event.roomCapacity} {event.roomCapacity === 1 ? "person" : "people"}
                </span>
              )}
            </div>
            {event.roomAmenities && event.roomAmenities.length > 0 && (
              <div className="flex flex-wrap gap-1 pl-6">
                {event.roomAmenities.map((amenity) => (
                  <span
                    key={amenity}
                    className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {amenity}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
