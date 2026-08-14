import { useState, useEffect, useMemo } from "react";
import { X, CalendarPlus, Warning } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { TimeSelect } from "@/features/calendar/components/modals/TimeSelect";
import { selectRoomsLoading } from "@/features/rooms/store/roomsSlice";
import { createBooking } from "@/features/rooms/store/roomsThunks";
import { RoomPicker } from "@/features/rooms/components/shared/RoomPicker";

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fires only when a booking was actually created, so callers can refresh their view. */
  onBooked?: () => void;
  roomId?: string;
  roomName?: string;
}

interface BookingFormState {
  selectedRoomId: string | null;
  date: string; // YYYY-MM-DD
  startTime: number; // decimal hours (e.g. 9.25 = 9:15 AM)
  endTime: number; // decimal hours
  title: string;
  notes: string;
}

function getTodayString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function decimalToTimeString(decimal: number): string {
  const hours = Math.floor(decimal);
  const minutes = Math.round((decimal % 1) * 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function BookingModal({ isOpen, onClose, onBooked, roomId, roomName }: BookingModalProps) {
  const dispatch = useAppDispatch();
  const loading = useAppSelector(selectRoomsLoading);
  const orgId = useAppSelector((state) => state.auth.currentOrganizationId) || "";

  const [form, setForm] = useState<BookingFormState>({
    selectedRoomId: roomId || null,
    date: getTodayString(),
    startTime: 9,
    endTime: 10,
    title: "",
    notes: "",
  });

  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react/react-compiler -- resetting form state when modal opens
      setForm({
        selectedRoomId: roomId || null,
        date: getTodayString(),
        startTime: 9,
        endTime: 10,
        title: "",
        notes: "",
      });
      setConflict(false);
    }
  }, [isOpen, roomId]);

  const timeError = useMemo(() => {
    if (form.startTime >= form.endTime) {
      return "End time must be after start time";
    }
    return null;
  }, [form.startTime, form.endTime]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.selectedRoomId || !form.date || timeError) return;

    const startTimeStr = decimalToTimeString(form.startTime);
    const endTimeStr = decimalToTimeString(form.endTime);
    const startIso = `${form.date}T${startTimeStr}:00`;
    const endIso = `${form.date}T${endTimeStr}:00`;

    try {
      const result = await dispatch(
        createBooking({
          organizationId: orgId,
          roomId: form.selectedRoomId,
          startTime: startIso,
          endTime: endIso,
          title: form.title || undefined,
          notes: form.notes || undefined,
        }),
      );

      if (createBooking.rejected.match(result)) {
        const errorMsg = (result.payload as string) || "";
        if (
          errorMsg.toLowerCase().includes("conflict") ||
          errorMsg.toLowerCase().includes("booked") ||
          errorMsg.toLowerCase().includes("overlap")
        ) {
          setConflict(true);
          return;
        }
      }

      if (createBooking.fulfilled.match(result)) {
        onBooked?.();
        onClose();
      }
    } catch {
      // handled by errorToastMiddleware
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isSubmitting = loading.creating;
  const canSubmit = !!form.selectedRoomId && !!form.date && !timeError;

  const startTimeStr = decimalToTimeString(form.startTime);
  const endTimeStr = decimalToTimeString(form.endTime);
  const pickerStartTime = form.date ? `${form.date}T${startTimeStr}:00` : undefined;
  const pickerEndTime = form.date ? `${form.date}T${endTimeStr}:00` : undefined;

  return (
    <div className="fixed inset-0 z-100 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      <div
        className={cn(
          "relative bg-card w-[calc(100vw-2rem)] max-w-md mx-4",
          "rounded-t-xl sm:rounded-xl",
          "shadow-2xl border border-border overflow-hidden",
          "animate-in zoom-in-95 fade-in duration-200",
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <CalendarPlus size={20} weight="duotone" className="text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">Book a Room</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 max-h-[60vh] overflow-y-auto flex flex-col gap-4">
            {roomId && roomName ? (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Room</label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm text-foreground">
                  {roomName}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  Room <span className="text-red-500">*</span>
                </label>
                <RoomPicker
                  selectedRoomId={form.selectedRoomId}
                  onSelect={(id) => {
                    setForm((prev) => ({ ...prev, selectedRoomId: id }));
                    setConflict(false);
                  }}
                  organizationId={orgId}
                  startTime={pickerStartTime}
                  endTime={pickerEndTime}
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">
                Date <span className="text-red-500">*</span>
              </label>
              <DatePicker
                value={form.date}
                onChange={(value) => {
                  setForm((prev) => ({ ...prev, date: value }));
                  setConflict(false);
                }}
                placeholder="Pick a date"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  Start Time <span className="text-red-500">*</span>
                </label>
                <TimeSelect
                  value={form.startTime}
                  onChange={(value) => {
                    setForm((prev) => ({ ...prev, startTime: value }));
                    setConflict(false);
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  End Time <span className="text-red-500">*</span>
                </label>
                <TimeSelect
                  value={form.endTime}
                  onChange={(value) => {
                    setForm((prev) => ({ ...prev, endTime: value }));
                    setConflict(false);
                  }}
                />
              </div>
            </div>

            {timeError && <p className="text-xs text-red-500">{timeError}</p>}

            {conflict && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800">
                <Warning
                  size={16}
                  className="text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5"
                />
                <p className="text-xs text-yellow-800 dark:text-yellow-400">
                  This room is already booked during the selected time. Please choose a different
                  time or room.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Title</label>
              <Input
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Team standup, interview, etc."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional notes..."
                rows={2}
                className={cn(
                  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "resize-none",
                )}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 bg-muted/30 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="md"
              loading={isSubmitting}
              disabled={isSubmitting || !canSubmit}
            >
              Book Room
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
