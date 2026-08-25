import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  X,
  CaretDown,
  CaretRight,
  Clock,
  Door,
  Tag,
  TextAa,
  Users,
  UsersThree,
  Warning,
  VideoCamera,
  Prohibit,
  Link as LinkIcon,
  Sliders,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  displayDayKey,
  displayParts,
  instantDayKey,
  instantFromDisplayParts,
} from "@/features/calendar/utils";
import { SchedulingPanel } from "@/features/calendar/components/scheduling/SchedulingPanel";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";
import { selectEvent } from "@/features/calendar/store/calendarUiSlice";
import { createEvent } from "@/features/calendar/store/calendarThunks";
import { attachmentsApi } from "@/features/files/api/attachmentsApi";
import { cn } from "@/shared/utils/cn";
import { formatDateWithWeekday, parseCalendarDate } from "@/shared/utils/dateFormatting";
import { ExpandableEditor } from "@/components/editor/ExpandableEditor";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { getInitials } from "@/components/subject/utils";
import { AttendeesSelector } from "@/features/calendar/components/modals/AttendeesSelector";
import { RoomPicker } from "@/features/rooms/components/shared/RoomPicker";
import { RecurrenceSelector } from "@/features/calendar/components/modals/RecurrenceSelector";
import { TimeSelect } from "@/features/calendar/components/modals/TimeSelect";
import { DatePicker } from "@/components/ui/date-picker";
import { useConflictDetection } from "@/features/calendar/hooks/useConflictDetection";
import { TagPicker } from "@/features/tags";
import type { Attendee, RecurrenceConfig } from "@/features/calendar/types";
import { MeetingChannelPicker } from "@/features/calendar/components/modals/MeetingChannelPicker";
import type { MeetingMode } from "@/features/calendar/utils/meeting";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Seed categories carry placeholder ids (`cat-*`); only real UUIDs go to the API. */
function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function getDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function generateDateOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const today = parseCalendarDate(instantDayKey(new Date()));

  for (let i = 7; i >= 1; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateString = getDateString(date);
    options.push({ value: dateString, label: formatDateWithWeekday(dateString) });
  }

  for (let i = 0; i <= 60; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateString = getDateString(date);
    const label =
      i === 0 ? `Today, ${formatDateWithWeekday(dateString)}` : formatDateWithWeekday(dateString);
    options.push({ value: dateString, label });
  }

  return options;
}

interface QuickEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDate?: Date;
  initialStartHour?: number;
  initialEndHour?: number;
}

export function QuickEventModal({
  isOpen,
  onClose,
  initialDate,
  initialStartHour = 9,
  initialEndHour = 10,
}: QuickEventModalProps) {
  const dispatch = useAppDispatch();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isMultiDay, setIsMultiDay] = useState(false);
  // `initialDate` is a calendar token; bare "today" is the display zone's day.
  const [startDate, setStartDate] = useState(() =>
    initialDate ? getDateString(initialDate) : instantDayKey(new Date()),
  );
  const [endDate, setEndDate] = useState(() =>
    initialDate ? getDateString(initialDate) : instantDayKey(new Date()),
  );
  const [startHour, setStartHour] = useState(initialStartHour);
  const [endHour, setEndHour] = useState(initialEndHour);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [recurrence, setRecurrence] = useState<RecurrenceConfig | undefined>(undefined);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [meetingMode, setMeetingMode] = useState<MeetingMode>("none");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [channelAutoCreated, setChannelAutoCreated] = useState(false);
  const [isTentative, setIsTentative] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isFree, setIsFree] = useState(false);
  const [isOutOfOffice, setIsOutOfOffice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFindTime, setShowFindTime] = useState(false);
  const pendingFileIdsRef = useRef<string[]>([]);

  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const categories = useAppSelector((state) => state.calendar.categories);
  const currentUser = useAppSelector((state) => state.auth.user);

  const handleFileUploaded = useCallback((fileId: string) => {
    pendingFileIdsRef.current.push(fileId);
  }, []);

  // Conflict detection compares stored instants, so the picked wall clock
  // converts through the display zone like the submit path does.
  const startIso = useMemo(() => {
    if (!startDate) return null;
    return instantFromDisplayParts(
      startDate,
      Math.floor(startHour),
      Math.round((startHour % 1) * 60),
    ).toISOString();
  }, [startDate, startHour]);

  const endIso = useMemo(() => {
    const dateStr = isMultiDay ? endDate : startDate;
    if (!dateStr) return null;
    return instantFromDisplayParts(
      dateStr,
      Math.floor(endHour),
      Math.round((endHour % 1) * 60),
    ).toISOString();
  }, [startDate, endDate, endHour, isMultiDay]);

  const conflicts = useConflictDetection(startIso, endIso);

  const dateOptions = useMemo(() => generateDateOptions(), []);

  const categoryOptions = useMemo(
    () =>
      Object.entries(categories).map(([id, cat]) => ({
        value: id,
        label: cat.name,
        color: cat.color,
      })),
    [categories],
  );

  // Reset form when modal opens + Escape key to close
  useEffect(() => {
    if (isOpen) {
      const day = initialDate ? getDateString(initialDate) : instantDayKey(new Date());
      // The modal stays mounted and only renders null while closed, so each open reseeds the form.
      // eslint-disable-next-line react/react-compiler
      setTitle("");
      setDescription("");
      setIsMultiDay(false);
      setStartDate(day);
      setEndDate(day);
      setStartHour(initialStartHour);
      setEndHour(initialEndHour);
      setRecurrence(undefined);
      setTagIds([]);
      setMeetingMode("none");
      setMeetingUrl("");
      setSelectedChannelId(null);
      setChannelAutoCreated(false);
      setIsTentative(false);
      setIsPrivate(false);
      setIsFree(false);
      setIsOutOfOffice(false);
      setIsSubmitting(false);

      const categoryIds = Object.keys(categories || {});
      if (categoryIds.length > 0) {
        setSelectedCategoryId(categoryIds[0]);
      }
      setAttendees([]);
      pendingFileIdsRef.current = [];

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          onClose();
        }
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialStartHour, initialEndHour]);

  const handleAttendeeAdd = (member: { userId: string; displayName: string; email: string }) => {
    if (attendees.some((a) => a.id === member.userId)) return;

    const newAttendee: Attendee = {
      id: member.userId,
      name: member.displayName || member.email,
      email: member.email,
      status: "pending",
      role: "required",
      initials: getInitials(member.displayName || member.email),
    };

    setAttendees((prev) => [...prev, newAttendee]);
  };

  const handleAttendeeRemove = (userId: string) => {
    setAttendees((prev) => prev.filter((a) => a.id !== userId));
  };

  const handleMeetingModeChange = (mode: MeetingMode) => {
    setMeetingMode(mode);
    if (mode !== "link") setMeetingUrl("");
    if (mode !== "channel") {
      setSelectedChannelId(null);
      setChannelAutoCreated(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);

    let eventStartTime: Date;
    let eventEndTime: Date;

    if (isMultiDay) {
      const startMinutes = Math.round((startHour % 1) * 60);
      eventStartTime = instantFromDisplayParts(startDate, Math.floor(startHour), startMinutes);

      const endMinutes = Math.round((endHour % 1) * 60);
      eventEndTime = instantFromDisplayParts(endDate, Math.floor(endHour), endMinutes);
    } else {
      const startMinutes = Math.round((startHour % 1) * 60);
      eventStartTime = instantFromDisplayParts(startDate, Math.floor(startHour), startMinutes);

      const endMinutes = Math.round((endHour % 1) * 60);
      eventEndTime = instantFromDisplayParts(startDate, Math.floor(endHour), endMinutes);
    }

    const result = await dispatch(
      createEvent({
        title: title.trim(),
        description,
        startTime: eventStartTime.toISOString(),
        endTime: eventEndTime.toISOString(),
        isAllDay: isMultiDay,
        timezone: getEffectiveTimeZone(),
        calendarId: "",
        categoryId: isValidUuid(selectedCategoryId) ? selectedCategoryId : undefined,
        isFocusTime: selectedCategoryId === "cat-deepwork",
        attendeeIds: attendees.map((a) => a.id),
        attendees: attendees.map((a) => ({ userId: a.id, role: a.role })),
        recurrence,
        roomId: selectedRoomId || undefined,
        tagIds,
        meetingUrl: meetingMode === "link" ? meetingUrl.trim() || undefined : undefined,
        channelId: meetingMode === "channel" ? selectedChannelId || undefined : undefined,
        channelAutoCreated:
          meetingMode === "channel" && selectedChannelId ? channelAutoCreated : undefined,
        status: isTentative ? "tentative" : undefined,
        visibility: isPrivate ? "private" : undefined,
        transparency: isFree ? "transparent" : undefined,
        isOutOfOffice,
      }),
    );

    if (createEvent.fulfilled.match(result)) {
      // Attach any files that were uploaded during creation (deferred mode)
      if (pendingFileIdsRef.current.length > 0 && organizationId) {
        await Promise.all(
          pendingFileIdsRef.current.map((fileId) =>
            attachmentsApi
              .attachFile({
                organizationId,
                sourceFileId: fileId,
                contentType: ContentType.CALENDAR_EVENT,
                contentId: result.payload.id,
              })
              .catch((err) => {
                console.error("[QuickEventModal] Failed to attach file:", err);
              }),
          ),
        );
        pendingFileIdsRef.current = [];
      }

      dispatch(selectEvent(result.payload.id));
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />

      <div
        className={`fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] ${showFindTime ? "max-w-3xl" : "max-w-xl"} animate-in zoom-in-95 fade-in duration-200`}
      >
        <div className="bg-background rounded-xl shadow-2xl border border-border overflow-hidden relative">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors z-10"
          >
            <X size={18} weight="bold" />
          </button>

          <form onSubmit={handleSubmit} className="max-h-[calc(85vh-80px)] overflow-y-auto">
            <div className="p-5 pt-12 space-y-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <TextAa size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Title</span>
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What's the event?"
                  className="w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Users size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Attendees</span>
                </div>
                <AttendeesSelector
                  attendees={attendees}
                  onAdd={handleAttendeeAdd}
                  onRemove={handleAttendeeRemove}
                />
              </div>

              {organizationId && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Door size={16} weight="duotone" className="text-muted-foreground" />
                    <span>Room</span>
                  </div>
                  <RoomPicker
                    selectedRoomId={selectedRoomId}
                    onSelect={setSelectedRoomId}
                    organizationId={organizationId}
                    startTime={startIso || undefined}
                    endTime={endIso || undefined}
                  />
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <VideoCamera size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Online meeting</span>
                </div>
                <div className="flex gap-2 p-1 bg-muted/50 rounded-lg">
                  {[
                    { mode: "none" as const, icon: Prohibit, label: "None" },
                    { mode: "link" as const, icon: LinkIcon, label: "Link" },
                    {
                      mode: "channel" as const,
                      icon: VideoCamera,
                      label: "Uniffy meeting",
                    },
                  ].map(({ mode, icon: Icon, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleMeetingModeChange(mode)}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all",
                        meetingMode === mode
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                    >
                      <Icon size={16} weight={meetingMode === mode ? "fill" : "duotone"} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {meetingMode === "link" && (
                  <input
                    type="url"
                    value={meetingUrl}
                    onChange={(e) => setMeetingUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  />
                )}

                {meetingMode === "channel" && (
                  <MeetingChannelPicker
                    selectedChannelId={selectedChannelId}
                    onSelect={(id) => {
                      setSelectedChannelId(id);
                      setChannelAutoCreated(false);
                    }}
                    onCreateRoom={(id) => {
                      setSelectedChannelId(id);
                      setChannelAutoCreated(true);
                    }}
                    attendeeIds={attendees.map((a) => a.id)}
                    eventTitle={title}
                  />
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Clock size={16} weight="duotone" className="text-muted-foreground" />
                    <span>Date & Time</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsMultiDay(!isMultiDay)}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span
                      className={cn(
                        "w-3.5 h-3.5 rounded-full border-2 transition-colors",
                        isMultiDay ? "border-primary bg-primary" : "border-muted-foreground",
                      )}
                    />
                    <span>Multi-day</span>
                  </button>
                </div>

                {isMultiDay ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">
                          Start Date
                        </label>
                        <Select
                          value={startDate}
                          onChange={(value) => {
                            setStartDate(value);
                            if (value > endDate) {
                              setEndDate(value);
                            }
                          }}
                          options={dateOptions}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">
                          Start Time
                        </label>
                        <TimeSelect
                          value={startHour}
                          onChange={(value) => {
                            setStartHour(value);
                            if (value >= endHour) {
                              setEndHour(value + 0.5);
                            }
                          }}
                          className="w-full"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">
                          End Date
                        </label>
                        <Select
                          value={endDate}
                          onChange={setEndDate}
                          options={dateOptions.filter((opt) => opt.value >= startDate)}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">
                          End Time
                        </label>
                        <TimeSelect value={endHour} onChange={setEndHour} className="w-full" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">Date</label>
                      <DatePicker
                        value={startDate}
                        onChange={(value) => {
                          setStartDate(value);
                          setEndDate(value);
                        }}
                        placeholder="Pick a date"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">Start</label>
                        <TimeSelect
                          value={startHour}
                          onChange={(value) => {
                            setStartHour(value);
                            if (value >= endHour) {
                              setEndHour(value + 0.5);
                            }
                          }}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">End</label>
                        <TimeSelect value={endHour} onChange={setEndHour} className="w-full" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {attendees.length > 0 && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowFindTime((value) => !value)}
                    className="flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
                  >
                    {showFindTime ? <CaretDown size={14} /> : <CaretRight size={14} />}
                    <UsersThree size={16} weight="duotone" className="text-muted-foreground" />
                    <span>Find a time</span>
                  </button>
                  {showFindTime && (
                    <SchedulingPanel
                      attendees={[
                        ...(currentUser
                          ? [
                              {
                                userId: currentUser.id,
                                name: currentUser.fullName || currentUser.username,
                                required: true,
                              },
                            ]
                          : []),
                        ...attendees
                          .filter((a) => a.id !== currentUser?.id)
                          .map((a) => ({
                            userId: a.id,
                            name: a.name,
                            required: a.role !== "optional",
                          })),
                      ]}
                      startIso={startIso}
                      endIso={endIso}
                      roomId={selectedRoomId}
                      onToggleRequired={(userId) => {
                        if (userId === currentUser?.id) return;
                        setAttendees((current) =>
                          current.map((a) =>
                            a.id === userId
                              ? { ...a, role: a.role === "optional" ? "required" : "optional" }
                              : a,
                          ),
                        );
                      }}
                      onPick={(pickedStart, pickedEnd) => {
                        setStartDate(displayDayKey(pickedStart));
                        setEndDate(displayDayKey(pickedEnd));
                        const startParts = displayParts(new Date(pickedStart));
                        const endParts = displayParts(new Date(pickedEnd));
                        setStartHour(startParts.hours + startParts.minutes / 60);
                        setEndHour(endParts.hours + endParts.minutes / 60);
                      }}
                    />
                  )}
                </div>
              )}

              <RecurrenceSelector value={recurrence} onChange={setRecurrence} />

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Tag size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Category</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {categoryOptions.map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setSelectedCategoryId(cat.value)}
                      className={cn(
                        "px-3 py-1.5 text-sm rounded-lg border transition-all",
                        selectedCategoryId === cat.value
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-2"
                        style={{ backgroundColor: cat.color }}
                      />
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Sliders size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Options</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["Tentative", isTentative, setIsTentative],
                      ["Private", isPrivate, setIsPrivate],
                      ["Free (doesn't block time)", isFree, setIsFree],
                      ["Out of office", isOutOfOffice, setIsOutOfOffice],
                    ] as const
                  ).map(([label, active, setActive]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setActive(!active)}
                      className={cn(
                        "px-3 py-1.5 text-sm rounded-lg border transition-all",
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Tag size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Tags</span>
                </div>
                <TagPicker selectedTagIds={tagIds} onChange={setTagIds} placeholder="Add tags..." />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <TextAa size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Description</span>
                  <span className="text-xs text-muted-foreground">(optional)</span>
                </div>
                <ExpandableEditor
                  contentType={ContentType.CALENDAR_EVENT}
                  contentId=""
                  value={description}
                  onChange={setDescription}
                  placeholder="Add notes, use @ to reference content..."
                  label="Description"
                  enableUpload
                  onFileUploaded={handleFileUploaded}
                />
              </div>
            </div>

            {conflicts.length > 0 && (
              <div
                className="mx-5 mb-3 p-3 rounded-lg text-sm"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--status-warning) 8%, transparent)",
                  color: "var(--status-warning)",
                }}
              >
                <div className="flex items-center gap-2 font-medium mb-1">
                  <Warning size={16} weight="duotone" />
                  Scheduling conflict ({conflicts.length})
                </div>
                <div className="text-xs opacity-80">
                  Overlaps with: {conflicts.map((c) => c.title).join(", ")}
                </div>
              </div>
            )}

            <div className="flex gap-3 px-5 py-4 border-t border-border bg-muted/20">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={onClose}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                size="md"
                disabled={!title.trim() || isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? "Creating..." : "Create Event"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
