import { describe, expect, it } from "vitest";
import { logout, rehydrateComplete, setCredentials } from "@/features/auth/store/authSlice";
import {
  firstUseAcknowledged,
  recordingDone,
  recordingReducer,
} from "@/features/recording/store/recordingSlice";

const credentials = (userId: string) => ({
  user: { id: userId } as Parameters<typeof setCredentials>[0]["user"],
  accessToken: "token",
  refreshToken: "refresh",
});

const seeded = (userId: string) => {
  let state = recordingReducer(undefined, setCredentials(credentials(userId)));
  state = recordingReducer(state, firstUseAcknowledged());
  return recordingReducer(state, recordingDone({ fileId: "file-1", filename: "clip.mp4" }));
};

describe("recording slice account scoping", () => {
  it("keeps recents and consent across a reload by the same user", () => {
    const state = recordingReducer(seeded("user-a"), rehydrateComplete(credentials("user-a")));
    expect(state.recents).toHaveLength(1);
    expect(state.firstUseAcknowledged).toBe(true);
    expect(state.ownerUserId).toBe("user-a");
  });

  it("drops recents and consent when a different user signs in", () => {
    const state = recordingReducer(seeded("user-a"), setCredentials(credentials("user-b")));
    expect(state.recents).toEqual([]);
    expect(state.firstUseAcknowledged).toBe(false);
    expect(state.ownerUserId).toBe("user-b");
  });

  it("clears recents on logout", () => {
    const state = recordingReducer(seeded("user-a"), logout());
    expect(state.recents).toEqual([]);
  });
});
