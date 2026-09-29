import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveUrns: vi.fn(),
  getMyAccessRequestStatuses: vi.fn(),
}));

vi.mock("@/app/hooks", () => ({
  useAppSelector: () => null,
  useAppDispatch: () => vi.fn(),
}));

vi.mock("@/features/search/api/searchApi", () => ({
  searchApi: { resolveUrns: mocks.resolveUrns },
}));

vi.mock("@/features/permissions/api/membersApi", () => ({
  membersApi: { getMyAccessRequestStatuses: mocks.getMyAccessRequestStatuses },
}));

import { SearchResultType, UrnAvailability } from "@uniffy/proto/search/v1/search_pb";
import {
  clearMentionStates,
  emitMentionStateChange,
  getMentionState,
  mergeMentionState,
  replaceMentionState,
} from "@/components/mention/mentionStateEmitter";
import { MentionAvailability } from "@/components/mention/types";
import { MentionAccessRequestStatus } from "@/components/mention/types";
import { AccessRequestState } from "@uniffy/proto/permissions/v1/permissions_pb";
import {
  resolveUrnBatched,
  getCachedPreview,
  clearPreviewCache,
} from "@/components/mention/useBatchedSubjectResolver";

const ORG = "019fc01f-12b6-7c82-bb38-2849821c22cb";
const TEAM_URN = "urn:uniffy:content:TEAM:019fc01f-12b6-7d85-b72c-376943518a98";
const USER_URN = "urn:uniffy:content:USER:019fc01f-12b6-7e34-a5c4-6bda0116e279";
const NOTE_URN = "urn:uniffy:content:NOTE:019fc01f-12b6-7f11-a7f1-a3197c6cefca";

function resolved(urn: string, type: SearchResultType, title: string, description = "") {
  return {
    resolved: {
      [urn]: { title, description, type, metadata: { member_count: "3" } },
    },
  };
}

describe("preview cache live state", () => {
  beforeEach(() => {
    clearPreviewCache();
    clearMentionStates();
    mocks.resolveUrns.mockReset();
    mocks.getMyAccessRequestStatuses.mockReset();
  });

  it.each(["omitted", "failed"])(
    "publishes unavailable state for %s references",
    async (outcome) => {
      if (outcome === "omitted") mocks.resolveUrns.mockResolvedValue({ resolved: {} });
      else mocks.resolveUrns.mockRejectedValue(new Error("Network unavailable"));

      const preview = await resolveUrnBatched(NOTE_URN, ORG);

      expect(preview?.availability).toBe(MentionAvailability.Unavailable);
      expect(getMentionState(NOTE_URN)?.availability).toBe(MentionAvailability.Unavailable);
      expect(getCachedPreview(NOTE_URN)?.availability).toBe(MentionAvailability.Unavailable);
    },
  );

  it("recovers an unavailable reference on forced retry", async () => {
    mocks.resolveUrns
      .mockResolvedValueOnce({ resolved: {} })
      .mockResolvedValueOnce(resolved(NOTE_URN, SearchResultType.NOTE, "Planning"));

    await resolveUrnBatched(NOTE_URN, ORG);
    const preview = await resolveUrnBatched(NOTE_URN, ORG, { force: true });

    expect(preview?.availability).toBe(MentionAvailability.Available);
    expect(getMentionState(NOTE_URN)?.title).toBe("Planning");
    expect(getMentionState(NOTE_URN)?.availability).toBe(MentionAvailability.Available);
    expect(mocks.resolveUrns).toHaveBeenCalledTimes(2);
  });

  it("applies a team rename so the next hover reads the new name", async () => {
    mocks.resolveUrns.mockResolvedValue(resolved(TEAM_URN, SearchResultType.TEAM, "Platform"));
    await resolveUrnBatched(TEAM_URN, ORG);
    expect(getCachedPreview(TEAM_URN)?.title).toBe("Platform");

    emitMentionStateChange(TEAM_URN, { title: "Core Platform" });

    expect(getCachedPreview(TEAM_URN)?.title).toBe("Core Platform");
  });

  it("applies a user rename and a description change", async () => {
    mocks.resolveUrns.mockResolvedValue(
      resolved(USER_URN, SearchResultType.USER, "Ada L", "ada@uniffy.io"),
    );
    await resolveUrnBatched(USER_URN, ORG);

    emitMentionStateChange(USER_URN, {
      title: "Ada Lovelace",
      description: "ada.lovelace@uniffy.io",
    });

    const cached = getCachedPreview(USER_URN);
    expect(cached?.title).toBe("Ada Lovelace");
    expect(cached?.description).toBe("ada.lovelace@uniffy.io");
  });

  it("keeps unrelated fields and ignores patches without copy changes", async () => {
    mocks.resolveUrns.mockResolvedValue(resolved(TEAM_URN, SearchResultType.TEAM, "Platform"));
    await resolveUrnBatched(TEAM_URN, ORG);
    const before = getCachedPreview(TEAM_URN);

    emitMentionStateChange(TEAM_URN, { teamMemberCount: 9 });

    expect(getCachedPreview(TEAM_URN)).toBe(before);
    expect(getCachedPreview(TEAM_URN)?.metadata?.member_count).toBe("3");
  });

  it("ignores patches for urns that were never resolved", () => {
    emitMentionStateChange(TEAM_URN, { title: "Ghost" });

    expect(getCachedPreview(TEAM_URN)).toBeUndefined();
  });

  it("force-resolves a restricted preview into a full available state", async () => {
    mocks.resolveUrns
      .mockResolvedValueOnce({
        resolved: {
          [TEAM_URN]: {
            title: "",
            description: "",
            type: SearchResultType.TEAM,
            metadata: {},
            availability: UrnAvailability.RESTRICTED,
            canRequestAccess: false,
          },
        },
      })
      .mockResolvedValueOnce({
        resolved: {
          [TEAM_URN]: {
            title: "Platform",
            description: "",
            type: SearchResultType.TEAM,
            metadata: { member_count: "3" },
            availability: UrnAvailability.AVAILABLE,
            canRequestAccess: false,
          },
        },
      });

    const restricted = await resolveUrnBatched(TEAM_URN, ORG);
    const available = await resolveUrnBatched(TEAM_URN, ORG, { force: true });

    expect(restricted?.availability).toBe(MentionAvailability.Restricted);
    expect(restricted?.title).toBe("");
    expect(available?.availability).toBe(MentionAvailability.Available);
    expect(available?.title).toBe("Platform");
    expect(getMentionState(TEAM_URN)?.availability).toBe(MentionAvailability.Available);
    expect(mocks.resolveUrns).toHaveBeenCalledTimes(2);
  });

  it("replaces access-transition state without retaining restricted fields", () => {
    replaceMentionState(TEAM_URN, {
      urn: TEAM_URN,
      availability: MentionAvailability.Restricted,
      canRequestAccess: true,
      accessRequestId: "request-id",
    });
    replaceMentionState(TEAM_URN, {
      urn: TEAM_URN,
      title: "Platform",
      availability: MentionAvailability.Available,
    });

    expect(getMentionState(TEAM_URN)).toEqual({
      urn: TEAM_URN,
      title: "Platform",
      availability: MentionAvailability.Available,
    });
  });

  it("batch-fetches request status for requestable restricted previews", async () => {
    mocks.resolveUrns.mockResolvedValue({
      resolved: {
        [TEAM_URN]: {
          title: "",
          description: "",
          type: SearchResultType.TEAM,
          metadata: {},
          availability: UrnAvailability.RESTRICTED,
          canRequestAccess: true,
        },
        [NOTE_URN]: {
          title: "",
          description: "",
          type: SearchResultType.NOTE,
          metadata: {},
          availability: UrnAvailability.RESTRICTED,
          canRequestAccess: true,
        },
      },
    });
    mocks.getMyAccessRequestStatuses.mockResolvedValue({
      statuses: [
        {
          requestedUrn: NOTE_URN,
          requestId: "019fc01f-12b6-7000-bba7-2e7c6de0e775",
          state: AccessRequestState.PENDING,
        },
      ],
    });

    const [team, note] = await Promise.all([
      resolveUrnBatched(TEAM_URN, ORG),
      resolveUrnBatched(NOTE_URN, ORG),
    ]);

    expect(mocks.getMyAccessRequestStatuses).toHaveBeenCalledOnce();
    expect(mocks.getMyAccessRequestStatuses).toHaveBeenCalledWith({
      organizationId: ORG,
      requestedUrns: [TEAM_URN, NOTE_URN],
    });
    expect(team?.accessRequestStatus).toBeUndefined();
    expect(note?.accessRequestStatus).toBe(MentionAccessRequestStatus.Pending);
    expect(getMentionState(NOTE_URN)?.accessRequestStatus).toBe(MentionAccessRequestStatus.Pending);
  });

  it("merges stream request state into the shared mention and preview caches", async () => {
    mocks.resolveUrns.mockResolvedValue({
      resolved: {
        [NOTE_URN]: {
          title: "",
          description: "",
          type: SearchResultType.NOTE,
          metadata: {},
          availability: UrnAvailability.RESTRICTED,
          canRequestAccess: false,
        },
      },
    });
    await resolveUrnBatched(NOTE_URN, ORG);

    mergeMentionState(NOTE_URN, {
      accessRequestId: "019fc01f-12b6-7000-bba7-2e7c6de0e775",
      accessRequestStatus: MentionAccessRequestStatus.Pending,
    });

    expect(getMentionState(NOTE_URN)?.accessRequestStatus).toBe(MentionAccessRequestStatus.Pending);
    expect(getCachedPreview(NOTE_URN)?.accessRequestStatus).toBe(
      MentionAccessRequestStatus.Pending,
    );
  });
});
