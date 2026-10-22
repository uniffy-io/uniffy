import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrgCreationPolicy } from "@uniffy/proto/superadmin/v1/system_config_pb";
import { ORG_CREATION_POLICY_OPTIONS } from "@/features/admin/components/organization/orgCreationPolicies";
import { systemConfigApi } from "@/features/platform/api/systemConfigApi";

const shared = vi.hoisted(() => ({ setPolicy: vi.fn() }));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({ setOrgCreationPolicy: shared.setPolicy }),
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));

beforeEach(() => {
  shared.setPolicy.mockReset();
});

describe("ORG_CREATION_POLICY_OPTIONS", () => {
  it("labels every policy the server accepts and nothing else", () => {
    const policies = Object.values(OrgCreationPolicy).filter(
      (value): value is OrgCreationPolicy =>
        typeof value === "number" && value !== OrgCreationPolicy.UNSPECIFIED,
    );
    expect(ORG_CREATION_POLICY_OPTIONS.map((option) => option.value)).toEqual(policies);
    expect(ORG_CREATION_POLICY_OPTIONS.map((option) => option.label)).toEqual([
      "Platform operators only",
      "Operators and organization owners",
      "Anyone with a membership",
      "Any signed-in user",
    ]);
  });

  it("never shows the enum number as copy", () => {
    for (const option of ORG_CREATION_POLICY_OPTIONS) {
      expect(option.label).not.toMatch(/\d/);
    }
  });
});

describe("systemConfigApi.setOrgCreationPolicy", () => {
  it("passes the enum through as the request policy", async () => {
    const config = { orgCreation: { policy: OrgCreationPolicy.MEMBERS, source: "deployment" } };
    shared.setPolicy.mockResolvedValue({ config });

    await expect(systemConfigApi.setOrgCreationPolicy(OrgCreationPolicy.MEMBERS)).resolves.toEqual({
      config,
    });
    expect(shared.setPolicy).toHaveBeenCalledWith({ policy: OrgCreationPolicy.MEMBERS });
  });
});
