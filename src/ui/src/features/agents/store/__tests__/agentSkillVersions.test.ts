import { describe, expect, it } from "vitest";
import type { SkillVersion } from "@uniffy/proto/agents/v1/skills_pb";
import {
  agentSkillVersionsReducer,
  selectSkillVersions,
  selectSkillVersionsEntry,
} from "@/features/agents/store/agentSkillVersionsSlice";
import {
  skillVersionToPlain,
  fetchSkillVersions,
  setMainSkillVersion,
  revertSkill,
  type SerializedSkillVersion,
} from "@/features/agents/store/agentSkillVersionsThunks";
import type { SerializedSkill } from "@/features/agents/store/agentSkillsThunks";
import { diffStat, diffLineParts } from "@/features/agents/utils/skillDiff";

const SKILL = "skill-1";

const version = (
  n: number,
  over: Partial<SerializedSkillVersion> = {},
): SerializedSkillVersion => ({
  id: `v${n}`,
  skillId: SKILL,
  versionNumber: n,
  name: "report",
  displayName: "Report",
  description: "",
  content: `body v${n}`,
  whenToUse: "",
  requiresTools: [],
  requiresContext: [],
  authorId: undefined,
  authorKind: "user",
  changeSummary: `change ${n}`,
  parentVersionId: undefined,
  createdAt: undefined,
  ...over,
});

const skill = (over: Partial<SerializedSkill> = {}): SerializedSkill =>
  ({
    id: SKILL,
    activeVersionNumber: 3,
    activeVersionPinned: false,
    latestVersionNumber: 3,
    ...over,
  }) as SerializedSkill;

const seeded = () =>
  agentSkillVersionsReducer(
    undefined,
    fetchSkillVersions.fulfilled(
      {
        skillId: SKILL,
        versions: [version(3), version(2), version(1)],
        activeVersionNumber: 3,
        activeVersionPinned: false,
        latestVersionNumber: 3,
      },
      "req",
      SKILL,
    ),
  );

describe("skillVersionToPlain", () => {
  it("maps proto version fields and normalizes optionals", () => {
    const proto = {
      id: "v1",
      skillId: SKILL,
      versionNumber: 2,
      name: "report",
      displayName: "Report",
      description: "d",
      content: "BODY",
      whenToUse: "asked",
      requiresTools: ["search.query"],
      requiresContext: [],
      authorId: undefined,
      authorKind: "agent",
      changeSummary: "edited",
      parentVersionId: undefined,
      createdAt: undefined,
    } as unknown as SkillVersion;

    const plain = skillVersionToPlain(proto);
    expect(plain.versionNumber).toBe(2);
    expect(plain.authorKind).toBe("agent");
    expect(plain.requiresTools).toEqual(["search.query"]);
    expect(plain.authorId).toBeUndefined();
  });
});

describe("agentSkillVersions slice", () => {
  it("fetch populates the per-skill entry", () => {
    const state = seeded();
    const root = { agentSkillVersions: state } as never;
    expect(selectSkillVersions(SKILL)(root)).toHaveLength(3);
    expect(selectSkillVersionsEntry(SKILL)(root)?.activeVersionNumber).toBe(3);
    expect(selectSkillVersions("other")(root)).toEqual([]);
  });

  it("pinning an older version updates the main pointer", () => {
    let state = seeded();
    state = agentSkillVersionsReducer(
      state,
      setMainSkillVersion.fulfilled(
        {
          skillId: SKILL,
          skill: skill({ activeVersionNumber: 1, activeVersionPinned: true }),
        },
        "req",
        { skillId: SKILL, versionNumber: 1, followLatest: false },
      ),
    );
    const entry = state.bySkill[SKILL];
    expect(entry.activeVersionNumber).toBe(1);
    expect(entry.activeVersionPinned).toBe(true);
  });

  it("follow-latest clears the pin", () => {
    let state = agentSkillVersionsReducer(
      undefined,
      fetchSkillVersions.fulfilled(
        {
          skillId: SKILL,
          versions: [version(3), version(2), version(1)],
          activeVersionNumber: 1,
          activeVersionPinned: true,
          latestVersionNumber: 3,
        },
        "req",
        SKILL,
      ),
    );
    state = agentSkillVersionsReducer(
      state,
      setMainSkillVersion.fulfilled(
        {
          skillId: SKILL,
          skill: skill({ activeVersionNumber: 3, activeVersionPinned: false }),
        },
        "req",
        { skillId: SKILL, followLatest: true },
      ),
    );
    expect(state.bySkill[SKILL].activeVersionPinned).toBe(false);
    expect(state.bySkill[SKILL].activeVersionNumber).toBe(3);
  });

  it("revert prepends the new version and bumps latest", () => {
    let state = seeded();
    state = agentSkillVersionsReducer(
      state,
      revertSkill.fulfilled(
        {
          skillId: SKILL,
          skill: skill({ activeVersionNumber: 4, latestVersionNumber: 4 }),
          version: version(4, {
            content: "body v1",
            changeSummary: "Reverted to version 1",
          }),
        },
        "req",
        { skillId: SKILL, versionNumber: 1 },
      ),
    );
    const entry = state.bySkill[SKILL];
    expect(entry.versions[0].versionNumber).toBe(4);
    expect(entry.versions).toHaveLength(4);
    expect(entry.latestVersionNumber).toBe(4);
    expect(entry.activeVersionNumber).toBe(4);
  });
});

describe("skillDiff", () => {
  it("counts added and removed lines", () => {
    const stat = diffStat("a\nb\nc", "a\nB\nc");
    expect(stat.added).toBe(1);
    expect(stat.removed).toBe(1);
  });

  it("counts a pure addition", () => {
    const stat = diffStat("a\nb", "a\nb\nc");
    expect(stat.added).toBe(1);
    expect(stat.removed).toBe(0);
  });

  it("marks added and removed line parts", () => {
    const parts = diffLineParts("old line", "new line");
    expect(parts.some((p) => p.added)).toBe(true);
    expect(parts.some((p) => p.removed)).toBe(true);
  });

  it("reports no changes for identical text", () => {
    const stat = diffStat("same\ntext", "same\ntext");
    expect(stat).toEqual({ added: 0, removed: 0 });
  });
});
