import type { AgentInfo } from "@uniffy/proto/agents/v1/agents_pb";
import { ENV } from "@/constants/env";

export interface SerializedAgent {
  id: string;
  name: string;
  description: string;
  avatarEmoji: string;
  themeColor: string;
  avatarKey: string;
  isDefault: boolean;
  primaryModel: string;
}

/** First line of the soul prompt, used as a short description. */
function shortDescription(soulPrompt: string): string {
  const firstLine = soulPrompt.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.trim().slice(0, 140);
}

export function agentToPlain(proto: AgentInfo): SerializedAgent {
  return {
    id: proto.id,
    name: proto.name,
    description: shortDescription(proto.soulPrompt),
    avatarEmoji: proto.avatarEmoji || "",
    themeColor: proto.themeColor || "#06b6d4",
    avatarKey: proto.avatarKey || "",
    isDefault: proto.isDefault,
    primaryModel: proto.primaryModel,
  };
}

/** Authenticated avatar image URL for an agent, when it has an uploaded image. */
export function agentAvatarUrl(
  organizationId: string,
  agentId: string,
  avatarKey: string,
): string | null {
  if (!avatarKey) return null;
  return `${ENV.apiUrl}/agents/avatars/${organizationId}/${agentId}`;
}
