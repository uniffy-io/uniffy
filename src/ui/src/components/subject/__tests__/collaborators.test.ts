import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { CollaboratorSchema, CollaboratorTier } from "@uniffy/proto/people/v1/people_pb";
import { MemberInfoSchema } from "@uniffy/proto/common/v1/common_pb";

const listCollaborators = vi.fn();
const recordPeoplePicks = vi.fn();
vi.mock("@/features/people/api/peopleApi", () => ({
  peopleApi: {
    listCollaborators: (...args: unknown[]) => listCollaborators(...args),
    recordPeoplePicks: (...args: unknown[]) => recordPeoplePicks(...args),
  },
}));

const {
  cachedSuggestedPeople,
  loadSuggestedPeople,
  recordPeoplePicks: recordPicks,
  resetPeoplePickerSession,
} = await import("@/components/subject/collaborators");

const collaborator = (userId: string, tier = CollaboratorTier.COLLABORATOR) =>
  create(CollaboratorSchema, {
    member: create(MemberInfoSchema, { userId, displayName: userId, email: `${userId}@x.io` }),
    tier,
  });

describe("suggested people", () => {
  beforeEach(() => {
    resetPeoplePickerSession();
    listCollaborators.mockReset();
    recordPeoplePicks.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("maps the ranking and its tier", async () => {
    listCollaborators.mockResolvedValue([
      collaborator("eve"),
      collaborator("ivan", CollaboratorTier.TEAMMATE),
    ]);
    const people = await loadSuggestedPeople("org", "bob");
    expect(people.map((p) => [p.id, p.tier])).toEqual([
      ["eve", "collaborator"],
      ["ivan", "teammate"],
    ]);
  });

  it("keeps each person's ranking apart on a shared tab", async () => {
    listCollaborators.mockResolvedValueOnce([collaborator("eve")]);
    await loadSuggestedPeople("org", "bob");
    expect(cachedSuggestedPeople("org", "bob")?.[0].id).toBe("eve");
    expect(cachedSuggestedPeople("org", "alice")).toBeNull();
    expect(cachedSuggestedPeople("other-org", "bob")).toBeNull();
  });

  it("shares one request between opens a moment apart, then refetches", async () => {
    listCollaborators.mockResolvedValue([collaborator("eve")]);
    await Promise.all([loadSuggestedPeople("org", "bob"), loadSuggestedPeople("org", "bob")]);
    expect(listCollaborators).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_500);
    listCollaborators.mockResolvedValue([collaborator("kristina")]);
    const pending = loadSuggestedPeople("org", "bob");
    // The previous list still paints while the refresh is in flight.
    expect(cachedSuggestedPeople("org", "bob")?.[0].id).toBe("eve");
    expect((await pending)[0].id).toBe("kristina");
    expect(listCollaborators).toHaveBeenCalledTimes(2);
  });

  it("forgets a failed load so the next open retries", async () => {
    listCollaborators.mockRejectedValueOnce(new Error("offline"));
    await expect(loadSuggestedPeople("org", "bob")).rejects.toThrow("offline");
    listCollaborators.mockResolvedValueOnce([collaborator("eve")]);
    await expect(loadSuggestedPeople("org", "bob")).resolves.toHaveLength(1);
  });
});

describe("recording picks", () => {
  beforeEach(() => {
    recordPeoplePicks.mockReset().mockResolvedValue(undefined);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("batches a burst of picks into one call per organization", () => {
    recordPicks("org", ["eve"]);
    recordPicks("org", ["eve", "ivan"]);
    recordPicks("other", ["zoe"]);
    expect(recordPeoplePicks).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(recordPeoplePicks).toHaveBeenCalledTimes(2);
    expect(recordPeoplePicks).toHaveBeenCalledWith("org", ["eve", "ivan"]);
    expect(recordPeoplePicks).toHaveBeenCalledWith("other", ["zoe"]);
  });

  it("drops picks not yet sent when the session ends", () => {
    recordPicks("org", ["eve"]);
    resetPeoplePickerSession();
    vi.advanceTimersByTime(2_000);
    expect(recordPeoplePicks).not.toHaveBeenCalled();
  });
});
