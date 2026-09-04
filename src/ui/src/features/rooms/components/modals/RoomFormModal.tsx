import { useState, useEffect, useCallback } from "react";
import { X, Plus } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { selectRoomsLoading } from "@/features/rooms/store/roomsSlice";
import { createRoom, updateRoom } from "@/features/rooms/store/roomsThunks";
import { ROOM_TYPE_LABELS, ROOM_STATUS_LABELS, AMENITY_OPTIONS } from "@/features/rooms/types";
import type { Room, RoomType, RoomStatus } from "@/features/rooms/types";

interface RoomFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  room?: Room;
}

const ROOM_TYPE_OPTIONS: SelectOption[] = Object.entries(ROOM_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const ROOM_STATUS_OPTIONS: SelectOption[] = Object.entries(ROOM_STATUS_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const VISIBILITY_OPTIONS: SelectOption[] = [
  { value: "private", label: "Private" },
  { value: "organization", label: "Organization" },
];

interface FormState {
  name: string;
  description: string;
  roomType: RoomType;
  capacity: string;
  building: string;
  floor: string;
  location: string;
  amenities: string[];
  visibility: "private" | "organization";
  status: RoomStatus;
}

export function RoomFormModal({ isOpen, onClose, room }: RoomFormModalProps) {
  const dispatch = useAppDispatch();
  const loading = useAppSelector(selectRoomsLoading);
  const currentOrganizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const isEdit = !!room;

  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    roomType: "meeting_room",
    capacity: "1",
    building: "",
    floor: "",
    location: "",
    amenities: [],
    visibility: "organization",
    status: "active",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      if (room) {
        // eslint-disable-next-line react/react-compiler -- resetting form state when modal opens with different room data
        setForm({
          name: room.name,
          description: room.description,
          roomType: room.roomType,
          capacity: String(room.capacity),
          building: room.building,
          floor: room.floor,
          location: room.location,
          amenities: [...room.amenities],
          visibility: room.visibility,
          status: room.status,
        });
      } else {
        setForm({
          name: "",
          description: "",
          roomType: "meeting_room",
          capacity: "1",
          building: "",
          floor: "",
          location: "",
          amenities: [],
          visibility: "organization",
          status: "active",
        });
      }
      setErrors({});
    }
  }, [isOpen, room]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    const name = form.name.trim();
    if (!name) {
      newErrors.name = "Name is required";
    } else if (name.length > 255) {
      newErrors.name = "Name must be 255 characters or less";
    }

    const cap = parseInt(form.capacity, 10);
    if (!form.capacity.trim()) {
      newErrors.capacity = "Capacity is required";
    } else if (isNaN(cap) || cap < 0) {
      newErrors.capacity = "Capacity must be 0 or greater";
    } else if (cap > 10000) {
      newErrors.capacity = "Capacity seems too high";
    }

    if (form.building.length > 100) {
      newErrors.building = "Building must be 100 characters or less";
    }

    if (form.floor.length > 50) {
      newErrors.floor = "Floor must be 50 characters or less";
    }

    if (form.location.length > 500) {
      newErrors.location = "Location must be 500 characters or less";
    }

    if (form.description.length > 2000) {
      newErrors.description = "Description must be 2000 characters or less";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleFieldChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const capacity = parseInt(form.capacity, 10);

    if (isEdit && room) {
      await dispatch(
        updateRoom({
          roomId: room.id,
          organizationId: room.organizationId,
          name: form.name,
          description: form.description,
          roomType: form.roomType,
          status: form.status,
          capacity,
          building: form.building,
          floor: form.floor,
          location: form.location,
          amenities: form.amenities,
          replaceAmenities: true,
          visibility: form.visibility,
        }),
      );
    } else {
      const orgId = currentOrganizationId;
      if (!orgId) return;
      await dispatch(
        createRoom({
          organizationId: orgId,
          name: form.name,
          description: form.description,
          roomType: form.roomType,
          capacity,
          floor: form.floor,
          building: form.building,
          location: form.location,
          amenities: form.amenities,
          visibility: form.visibility,
        }),
      );
    }

    onClose();
  };

  const [customAmenity, setCustomAmenity] = useState("");

  const handleAmenityToggle = (amenity: string) => {
    setForm((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter((a) => a !== amenity)
        : [...prev.amenities, amenity],
    }));
  };

  const handleAddCustomAmenity = useCallback(() => {
    const trimmed = customAmenity.trim();
    if (!trimmed) return;
    if (form.amenities.includes(trimmed)) {
      setCustomAmenity("");
      return;
    }
    setForm((prev) => ({
      ...prev,
      amenities: [...prev.amenities, trimmed],
    }));
    setCustomAmenity("");
  }, [customAmenity, form.amenities]);

  if (!isOpen) return null;

  const isSubmitting = loading.creating || loading.updating;

  return (
    <Modal onClose={onClose} closeDisabled={isSubmitting} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit}>
        <ModalHeader title={isEdit ? "Edit room" : "New room"} />

        <ModalBody>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Name</label>
            <Input
              value={form.name}
              onChange={(e) => handleFieldChange("name", e.target.value)}
              placeholder="Conference Room A"
              className={cn(errors.name && "border-red-500")}
            />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              Description (optional)
            </label>
            <Textarea
              value={form.description}
              onChange={(e) => handleFieldChange("description", e.target.value)}
              placeholder="A brief description of this room..."
              rows={3}
              className={cn(errors.description && "border-red-500")}
            />
            {errors.description && (
              <p className="mt-1 text-xs text-red-500">{errors.description}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Room type</label>
              <Select
                value={form.roomType}
                onChange={(val) => setForm((prev) => ({ ...prev, roomType: val as RoomType }))}
                options={ROOM_TYPE_OPTIONS}
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Capacity</label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={form.capacity}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, "");
                  handleFieldChange("capacity", val);
                }}
                className={cn(errors.capacity && "border-red-500")}
              />
              {errors.capacity && <p className="mt-1 text-xs text-red-500">{errors.capacity}</p>}
            </div>
          </div>

          {isEdit && (
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Status</label>
              <Select
                value={form.status}
                onChange={(val) => setForm((prev) => ({ ...prev, status: val as RoomStatus }))}
                options={ROOM_STATUS_OPTIONS}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                Building (optional)
              </label>
              <Input
                value={form.building}
                onChange={(e) => handleFieldChange("building", e.target.value)}
                placeholder="Main Office"
                className={cn(errors.building && "border-red-500")}
              />
              {errors.building && <p className="mt-1 text-xs text-red-500">{errors.building}</p>}
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Floor (optional)</label>
              <Input
                value={form.floor}
                onChange={(e) => handleFieldChange("floor", e.target.value)}
                placeholder="3"
                className={cn(errors.floor && "border-red-500")}
              />
              {errors.floor && <p className="mt-1 text-xs text-red-500">{errors.floor}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Location (optional)</label>
            <Input
              value={form.location}
              onChange={(e) => handleFieldChange("location", e.target.value)}
              placeholder="Wing B, near elevator"
              className={cn(errors.location && "border-red-500")}
            />
            {errors.location && <p className="mt-1 text-xs text-red-500">{errors.location}</p>}
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Amenities</label>
            <div className="grid grid-cols-2 gap-2">
              {AMENITY_OPTIONS.map((amenity) => (
                <Checkbox
                  key={amenity}
                  label={amenity}
                  checked={form.amenities.includes(amenity)}
                  onChange={() => handleAmenityToggle(amenity)}
                />
              ))}
            </div>

            {form.amenities.filter((a) => !AMENITY_OPTIONS.includes(a)).length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2">
                {form.amenities
                  .filter((a) => !AMENITY_OPTIONS.includes(a))
                  .map((amenity) => (
                    <span
                      key={amenity}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                    >
                      {amenity}
                      <button
                        type="button"
                        onClick={() => handleAmenityToggle(amenity)}
                        className="rounded-full p-0.5 hover:bg-primary/20 transition-colors"
                      >
                        <X size={10} weight="bold" />
                      </button>
                    </span>
                  ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Input
                value={customAmenity}
                onChange={(e) => setCustomAmenity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustomAmenity();
                  }
                }}
                placeholder="Other amenity..."
                className="h-8 flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddCustomAmenity}
                disabled={!customAmenity.trim()}
                className="h-8 shrink-0"
              >
                <Plus size={14} className="mr-1" />
                Add
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Visibility</label>
            <Select
              value={form.visibility}
              onChange={(val) =>
                setForm((prev) => ({
                  ...prev,
                  visibility: val as "private" | "organization",
                }))
              }
              options={VISIBILITY_OPTIONS}
            />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
            {isEdit ? "Save changes" : "Create room"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
