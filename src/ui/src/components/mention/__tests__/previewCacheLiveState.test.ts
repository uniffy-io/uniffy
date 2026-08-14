import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveUrns: vi.fn(),
}));

vi.mock("@/app/hooks", () => ({
  useAppSelector: () => null,
  useAppDispatch: () => vi.fn(),
}));

vi.mock("@/features/search", () => ({
  searchApi: { resolveUrns: mocks.resolveUrns },
}));

import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { emitMentionStateChange } from "@/components/mention/mentionStateEmitter";
import {
  resolveUrnBatched,
  getCachedPreview,
  clearPreviewCache,
} from "@/components/mention/useBatchedSubjectResolver";

const ORG = "019fc01f-12b6-7c82-bb38-2849821c22cb";
const TEAM_URN = "urn:uniffy:content:TEAM:019fc01f-12b6-7d85-b72c-376943518a98";
const USER_URN = "urn:uniffy:content:USER:019fc01f-12b6-7e34-a5c4-6bda0116e279";

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
    mocks.resolveUrns.mockReset();
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
});
