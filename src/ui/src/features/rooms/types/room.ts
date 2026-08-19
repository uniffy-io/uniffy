export type RoomType = "meeting_room" | "conference_room" | "office" | "other";
export type RoomStatus = "active" | "maintenance" | "retired";

export interface Room {
  id: string;
  organizationId: string;
  ownerId: string;
  name: string;
  description: string;
  roomType: RoomType;
  status: RoomStatus;
  capacity: number;
  floor: string;
  building: string;
  location: string;
  amenities: string[];
  imageFileId: string | null;
  visibility: "private" | "organization";
  accessMode: number;
  baselineRole: number | null;
  userRole: number;
  createdAt: string;
  updatedAt: string;
}

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  meeting_room: "Meeting Room",
  conference_room: "Conference Room",
  office: "Office",
  other: "Other",
};

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  active: "Active",
  maintenance: "Maintenance",
  retired: "Retired",
};

export const AMENITY_OPTIONS: string[] = [
  "Projector",
  "Whiteboard",
  "Video Conferencing",
  "Speaker Phone",
  "TV Screen",
  "Standing Desks",
  "Air Conditioning",
  "Natural Light",
  "Wheelchair Accessible",
];
