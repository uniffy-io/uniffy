import { describe, expect, it } from "vitest";
import type { RootState } from "@/app/store";
import { selectRoomAvailability } from "@/features/rooms/store/roomsSlice";
import type { TimeSlot } from "@/features/rooms/types";

const root = (availability: Record<string, TimeSlot[]>) =>
  ({ rooms: { availability } }) as unknown as RootState;

describe("selectRoomAvailability", () => {
  it("returns the same empty list for rooms without loaded slots", () => {
    const state = root({});
    expect(selectRoomAvailability(state, "room-1")).toBe(selectRoomAvailability(state, "room-2"));
    expect(selectRoomAvailability(state, "")).toHaveLength(0);
  });

  it("returns the stored slots for a loaded room", () => {
    const slots = [{} as TimeSlot];
    expect(selectRoomAvailability(root({ "room-1": slots }), "room-1")).toBe(slots);
  });
});
