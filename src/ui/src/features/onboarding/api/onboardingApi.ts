import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import {
  OrganizationsService,
  type OnboardingStep,
} from "@uniffy/proto/organizations/v1/organizations_pb";

const client = createClient(OrganizationsService, unaryTransport);

export const onboardingApi = {
  get: async (organizationId: string) => client.getOnboarding({ organizationId }),

  recordStep: async (organizationId: string, step: OnboardingStep) =>
    client.recordOnboardingStep({ organizationId, step }),

  finish: async (organizationId: string, dismissed: boolean) =>
    client.finishOnboarding({ organizationId, dismissed }),
};
