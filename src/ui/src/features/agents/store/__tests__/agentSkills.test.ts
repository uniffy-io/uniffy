import { describe, expect, it, vi } from "vitest";
import type { SkillInfo } from "@uniffy/proto/agents/v1/skills_pb";
import type { RootState } from "@/app/store";
import { skillToPlain, updateSkill } from "@/features/agents/store/agentSkillsThunks";
import { skillsApi } from "@/features/agents/api/skillsApi";

vi.mock("@/features/agents/api/skillsApi", () => ({
  skillsApi: { updateSkill: vi.fn() },
}));

const skillProto = (over: Partial<SkillInfo> = {}): SkillInfo =>
  ({
    id: "s1",
    organizationId: "org-1",
    name: "reporter",
    displayName: "Reporter",
    description: "desc",
    content: "BODY",
    requiresTools: ["notes.read_note"],
    supportedSurfaces: ["session"],
    source: 1,
    latestVersionNumber: 2,
    activeVersionNumber: 2,
    activeVersionPinned: false,
    ...over,
  }) as unknown as SkillInfo;

describe("skillToPlain", () => {
  it("keeps the active version separate from the latest version when pinned", () => {
    const plain = skillToPlain(
      skillProto({ latestVersionNumber: 4, activeVersionNumber: 1, activeVersionPinned: true }),
    );
    expect(plain.latestVersionNumber).toBe(4);
    expect(plain.activeVersionNumber).toBe(1);
    expect(plain.activeVersionPinned).toBe(true);
  });

  it("carries the fields needed to seed a manual edit draft", () => {
    const plain = skillToPlain(skillProto());
    expect(plain.content).toBe("BODY");
    expect(plain.requiresTools).toEqual(["notes.read_note"]);
    expect(plain.supportedSurfaces).toEqual(["session"]);
  });

  it("copies repeated fields into new arrays (no proto aliasing)", () => {
    const proto = skillProto();
    const plain = skillToPlain(proto);
    expect(plain.requiresTools).not.toBe(proto.requiresTools);
  });
});

describe("updateSkill", () => {
  const getState = () => ({ auth: { currentOrganizationId: "org-1" } }) as unknown as RootState;

  const runThunk = async (params: Parameters<typeof updateSkill>[0]) => {
    vi.mocked(skillsApi.updateSkill).mockResolvedValue({
      skill: skillProto(),
    } as never);
    await updateSkill(params)(vi.fn(), getState, undefined);
    return vi.mocked(skillsApi.updateSkill).mock.calls.at(-1)?.[0];
  };

  it("persists the human-readable description", async () => {
    const request = await runThunk({ skillId: "s1", description: "Weekly report workflow" });
    expect(request).toEqual({
      organizationId: "org-1",
      skillId: "s1",
      description: "Weekly report workflow",
    });
  });

  it("renames through display_name and never sends the immutable slug", async () => {
    const request = await runThunk({ skillId: "s1", displayName: "Weekly Report" });
    expect(request).toEqual({
      organizationId: "org-1",
      skillId: "s1",
      displayName: "Weekly Report",
    });
    expect(request).not.toHaveProperty("name");
  });

  it.each([{ tools: ["notes.read_note"] }, { tools: [] }])(
    "replaces or clears tool requirements: $tools",
    async ({ tools }) => {
      const request = await runThunk({ skillId: "s1", requiresTools: tools });
      expect(request).toEqual({
        organizationId: "org-1",
        skillId: "s1",
        requiresTools: { names: tools },
      });
    },
  );
});
