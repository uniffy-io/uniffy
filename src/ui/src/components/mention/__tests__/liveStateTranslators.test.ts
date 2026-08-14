import { describe, it, expect, vi } from "vitest";

vi.mock("@/app/hooks", () => ({
  useAppSelector: () => null,
  useAppDispatch: () => vi.fn(),
}));

vi.mock("@/features/search/api/searchApi", () => ({
  searchApi: { resolveUrns: vi.fn() },
}));

vi.mock("@/features/settings/hooks/useSettings", () => ({
  useAppearanceSettings: () => ({ mentionDisplay: "expanded" }),
}));

import { buildLiveStateFromMetadata } from "@/components/mention/buildLiveState";
import { streamChangesToLiveState } from "@/components/mention/MentionStateProvider";

const FOLDER_URN = "urn:uniffy:content:FOLDER:019fc01f-12b6-7c82-bb38-2849821c22cb";
const ROOM_URN = "urn:uniffy:content:ROOM:019fc01f-12b6-7d85-b72c-376943518a98";
const NOTE_URN = "urn:uniffy:content:NOTE:019fc01f-12b6-7e34-a5c4-6bda0116e279";

describe("container and room live-state translation", () => {
  it("maps folder child stats from index metadata", () => {
    const state = buildLiveStateFromMetadata(FOLDER_URN, "Design Assets", {
      file_count: "12",
      folder_count: "3",
      total_size: "50331648",
      parent_label: "Brand",
    });
    expect(state.folderFileCount).toBe(12);
    expect(state.folderSubfolderCount).toBe(3);
    expect(state.folderTotalSize).toBe(50331648);
    expect(state.parentLabel).toBe("Brand");
  });

  it("maps note folder child_count and room facts", () => {
    const note = buildLiveStateFromMetadata(NOTE_URN, "Policies", {
      node_type: "FOLDER",
      child_count: "8",
    });
    expect(note.noteNodeType).toBe("FOLDER");
    expect(note.noteChildCount).toBe(8);

    const room = buildLiveStateFromMetadata(ROOM_URN, "Alpha", {
      room_type: "MEETING_ROOM",
      capacity: "8",
      building: "HQ",
      floor: "2",
      location: "North wing",
      amenities: "Projector, Whiteboard",
    });
    expect(room.roomType).toBe("MEETING_ROOM");
    expect(room.roomCapacity).toBe(8);
    expect(room.roomBuilding).toBe("HQ");
    expect(room.roomFloor).toBe("2");
    expect(room.roomLocation).toBe("North wing");
    expect(room.roomAmenities).toBe("Projector, Whiteboard");
  });

  it("translates snake_case stream patches for the new fields", () => {
    const patch = streamChangesToLiveState({
      file_count: "13",
      folder_count: "3",
      total_size: "52428800",
      child_count: "9",
      room_type: "PHONE_BOOTH",
      capacity: "1",
      building: "HQ",
      floor: "3",
      location: "South wing",
      amenities: "Screen",
    });
    expect(patch.folderFileCount).toBe(13);
    expect(patch.folderSubfolderCount).toBe(3);
    expect(patch.folderTotalSize).toBe(52428800);
    expect(patch.noteChildCount).toBe(9);
    expect(patch.roomType).toBe("PHONE_BOOTH");
    expect(patch.roomCapacity).toBe(1);
    expect(patch.roomBuilding).toBe("HQ");
    expect(patch.roomFloor).toBe("3");
    expect(patch.roomLocation).toBe("South wing");
    expect(patch.roomAmenities).toBe("Screen");
  });

  it("keeps zero counts instead of dropping them", () => {
    const state = buildLiveStateFromMetadata(FOLDER_URN, "Empty", {
      file_count: "0",
      folder_count: "0",
      total_size: "0",
    });
    expect(state.folderFileCount).toBe(0);
    expect(state.folderSubfolderCount).toBe(0);
    expect(state.folderTotalSize).toBe(0);
  });
});
