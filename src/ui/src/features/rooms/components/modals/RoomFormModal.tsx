import { useState, useEffect, useCallback } from 'react';
import { X, Door, Plus } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import type { SelectOption } from '@/components/ui/select';
import { selectRoomsLoading } from '@/features/rooms/store/roomsSlice';
import { createRoom, updateRoom } from '@/features/rooms/store/roomsThunks';
import {
  ROOM_TYPE_LABELS,
  ROOM_STATUS_LABELS,
  AMENITY_OPTIONS,
} from '@/features/rooms/types';
import type { Room, RoomType, RoomStatus } from '@/features/rooms/types';

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
  { value: 'private', label: 'Private' },
  { value: 'organization', label: 'Organization' },
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
  visibility: 'private' | 'organization';
  status: RoomStatus;
}

export function RoomFormModal({ isOpen, onClose, room }: RoomFormModalProps) {
  const dispatch = useAppDispatch();
  const loading = useAppSelector(selectRoomsLoading);
  const currentOrganizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const isEdit = !!room;

  const [form, setForm] = useState<FormState>({
    name: '',
    description: '',
    roomType: 'meeting_room',
    capacity: '1',
    building: '',
    floor: '',
    location: '',
    amenities: [],
    visibility: 'organization',
    status: 'active',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      if (room) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting form state when modal opens with different room data
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
          name: '',
          description: '',
          roomType: 'meeting_room',
          capacity: '1',
          building: '',
          floor: '',
          location: '',
          amenities: [],
          visibility: 'organization',
          status: 'active',
        });
      }
      setErrors({});
    }
  }, [isOpen, room]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    const name = form.name.trim();
    if (!name) {
      newErrors.name = 'Name is required';
    } else if (name.length > 255) {
      newErrors.name = 'Name must be 255 characters or less';
    }

    const cap = parseInt(form.capacity, 10);
    if (!form.capacity.trim()) {
      newErrors.capacity = 'Capacity is required';
    } else if (isNaN(cap) || cap < 0) {
      newErrors.capacity = 'Capacity must be 0 or greater';
    } else if (cap > 10000) {
      newErrors.capacity = 'Capacity seems too high';
    }

    if (form.building.length > 100) {
      newErrors.building = 'Building must be 100 characters or less';
    }

    if (form.floor.length > 50) {
      newErrors.floor = 'Floor must be 50 characters or less';
    }

    if (form.location.length > 500) {
      newErrors.location = 'Location must be 500 characters or less';
    }

    if (form.description.length > 2000) {
      newErrors.description = 'Description must be 2000 characters or less';
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

  const [customAmenity, setCustomAmenity] = useState('');

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
      setCustomAmenity('');
      return;
    }
    setForm((prev) => ({
      ...prev,
      amenities: [...prev.amenities, trimmed],
    }));
    setCustomAmenity('');
  }, [customAmenity, form.amenities]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isSubmitting = loading.creating || loading.updating;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      <div
        className={cn(
          'relative bg-card w-[calc(100vw-2rem)] max-w-lg mx-4',
          'rounded-t-xl sm:rounded-xl',
          'shadow-2xl border border-border overflow-hidden',
          'animate-in zoom-in-95 fade-in duration-200',
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Door size={20} weight="duotone" className="text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">
              {isEdit ? 'Edit Room' : 'New Room'}
            </h2>
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
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">
                Name <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                placeholder="Conference Room A"
                className={cn(errors.name && 'border-red-500')}
              />
              {errors.name && (
                <span className="text-xs text-red-500">{errors.name}</span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => handleFieldChange('description', e.target.value)}
                placeholder="A brief description of this room..."
                rows={3}
                className={cn(
                  'flex w-full rounded-md border bg-background px-3 py-2 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'resize-none',
                  errors.description ? 'border-red-500' : 'border-input',
                )}
              />
              {errors.description && (
                <span className="text-xs text-red-500">{errors.description}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Room Type</label>
                <Select
                  value={form.roomType}
                  onChange={(val) => setForm((prev) => ({ ...prev, roomType: val as RoomType }))}
                  options={ROOM_TYPE_OPTIONS}
                  size="sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Capacity</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.capacity}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    handleFieldChange('capacity', val);
                  }}
                  className={cn('h-8', errors.capacity && 'border-red-500')}
                />
                {errors.capacity && (
                  <span className="text-xs text-red-500">{errors.capacity}</span>
                )}
              </div>
            </div>

            {isEdit && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Status</label>
                <Select
                  value={form.status}
                  onChange={(val) => setForm((prev) => ({ ...prev, status: val as RoomStatus }))}
                  options={ROOM_STATUS_OPTIONS}
                  size="sm"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Building</label>
                <Input
                  value={form.building}
                  onChange={(e) => handleFieldChange('building', e.target.value)}
                  placeholder="Main Office"
                  className={cn('h-8', errors.building && 'border-red-500')}
                />
                {errors.building && (
                  <span className="text-xs text-red-500">{errors.building}</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Floor</label>
                <Input
                  value={form.floor}
                  onChange={(e) => handleFieldChange('floor', e.target.value)}
                  placeholder="3"
                  className={cn('h-8', errors.floor && 'border-red-500')}
                />
                {errors.floor && (
                  <span className="text-xs text-red-500">{errors.floor}</span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Location</label>
              <Input
                value={form.location}
                onChange={(e) => handleFieldChange('location', e.target.value)}
                placeholder="Wing B, near elevator"
                className={cn(errors.location && 'border-red-500')}
              />
              {errors.location && (
                <span className="text-xs text-red-500">{errors.location}</span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-foreground">Amenities</label>
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
                <div className="flex flex-wrap gap-1.5 pt-1">
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

              <div className="flex items-center gap-2 pt-1">
                <Input
                  value={customAmenity}
                  onChange={(e) => setCustomAmenity(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
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

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Visibility</label>
              <Select
                value={form.visibility}
                onChange={(val) =>
                  setForm((prev) => ({
                    ...prev,
                    visibility: val as 'private' | 'organization',
                  }))
                }
                options={VISIBILITY_OPTIONS}
                size="sm"
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
              disabled={isSubmitting}
            >
              {isEdit ? 'Save Changes' : 'New Room'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
