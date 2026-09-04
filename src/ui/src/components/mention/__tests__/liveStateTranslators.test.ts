import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

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
import {
  metadataToLiveState,
  streamChangesToLiveState,
} from "@/components/mention/mentionLiveState";
import { MentionAvailability } from "@/components/mention/types";
import { MentionAccessRequestStatus } from "@/components/mention/types";
import { accessRequestStatusToLiveState } from "@/components/mention/accessRequestState";
import { UrnAvailability, UrnMetadataSchema } from "@uniffy/proto/search/v1/search_pb";
import {
  AccessRequestState,
  AccessRequestStatusSchema,
} from "@uniffy/proto/permissions/v1/permissions_pb";

const FOLDER_URN = "urn:uniffy:content:FOLDER:019fc01f-12b6-7c82-bb38-2849821c22cb";
const ROOM_URN = "urn:uniffy:content:ROOM:019fc01f-12b6-7d85-b72c-376943518a98";
const NOTE_URN = "urn:uniffy:content:NOTE:019fc01f-12b6-7e34-a5c4-6bda0116e279";

describe("container and room live-state translation", () => {
  it.each([
    [UrnAvailability.AVAILABLE, MentionAvailability.Available],
    [UrnAvailability.RESTRICTED, MentionAvailability.Restricted],
    [UrnAvailability.DELETED, MentionAvailability.Deleted],
    [UrnAvailability.UNAVAILABLE, MentionAvailability.Unavailable],
  ])("maps typed availability %s", (availability, expected) => {
    const state = metadataToLiveState(
      NOTE_URN,
      create(UrnMetadataSchema, {
        availability,
        canRequestAccess: availability === UrnAvailability.RESTRICTED,
      }),
    );

    expect(state.availability).toBe(expected);
    expect(state.canRequestAccess).toBe(availability === UrnAvailability.RESTRICTED);
  });

  it("keeps the deleted compatibility projection at the translation boundary", () => {
    const state = metadataToLiveState(
      NOTE_URN,
      create(UrnMetadataSchema, { urnStatus: "DELETED" }),
    );

    expect(state.availability).toBe(MentionAvailability.Deleted);
  });

  it.each([
    [AccessRequestState.PENDING, MentionAccessRequestStatus.Pending],
    [AccessRequestState.APPROVED, MentionAccessRequestStatus.Approved],
    [AccessRequestState.DENIED, MentionAccessRequestStatus.Denied],
    [AccessRequestState.CANCELED, MentionAccessRequestStatus.Canceled],
  ])("maps access request state %s", (requestState, expected) => {
    const retryAt = new Date("2026-08-17T12:30:00.000Z");
    const state = accessRequestStatusToLiveState(
      create(AccessRequestStatusSchema, {
        requestedUrn: NOTE_URN,
        requestId: "019fc01f-12b6-7f11-a7f1-a3197c6cefca",
        state: requestState,
        canRequestAgainAt: timestampFromDate(retryAt),
      }),
    );

    expect(state.accessRequestStatus).toBe(expected);
    expect(state.accessRequestId).toBe("019fc01f-12b6-7f11-a7f1-a3197c6cefca");
    expect(state.canRequestAgainAt).toBe(retryAt.toISOString());
  });

  it("ignores an unspecified access request status", () => {
    expect(
      accessRequestStatusToLiveState(
        create(AccessRequestStatusSchema, {
          requestedUrn: NOTE_URN,
          state: AccessRequestState.UNSPECIFIED,
        }),
      ),
    ).toEqual({});
  });

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

  it("maps calendar event status from metadata and stream patches", () => {
    const CALENDAR_URN = "urn:uniffy:content:CALENDAR_EVENT:019fc01f-12b6-7f11-a000-000000000001";
    const state = metadataToLiveState(
      CALENDAR_URN,
      create(UrnMetadataSchema, {
        availability: UrnAvailability.AVAILABLE,
        eventStatus: "CANCELLED",
        metadata: { start_time: "2026-09-01T10:00:00+00:00" },
      }),
    );
    expect(state.eventStatus).toBe("CANCELLED");
    expect(state.eventStartTime).toBe("2026-09-01T10:00:00+00:00");

    const patch = streamChangesToLiveState({ event_status: "CONFIRMED" });
    expect(patch.eventStatus).toBe("CONFIRMED");
  });

  it("translates availability stream states", () => {
    expect(streamChangesToLiveState({ availability: "RESTRICTED" }).availability).toBe(
      MentionAvailability.Restricted,
    );
    expect(streamChangesToLiveState({ urn_status: "DELETED" }).availability).toBe(
      MentionAvailability.Deleted,
    );
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
