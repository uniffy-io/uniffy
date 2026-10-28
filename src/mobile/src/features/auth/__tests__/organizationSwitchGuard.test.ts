import { describe, expect, it } from "vitest";
import { claimOrganizationSwitch } from "@features/auth/organizationSwitchGuard";

describe("claimOrganizationSwitch", () => {
  it("refuses a second claim until the first is released", () => {
    const accept = claimOrganizationSwitch();
    expect(accept).not.toBeNull();
    expect(claimOrganizationSwitch()).toBeNull();

    accept?.();
    const select = claimOrganizationSwitch();
    expect(select).not.toBeNull();
    select?.();
  });

  it("ignores a repeated release from a claim that already ended", () => {
    const first = claimOrganizationSwitch();
    first?.();
    const second = claimOrganizationSwitch();

    first?.();
    expect(claimOrganizationSwitch()).toBeNull();
    second?.();
  });
});
