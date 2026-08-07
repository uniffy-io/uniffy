import type { AgentInfo } from "@uniffy/proto/agents/v1/agents_pb";
import { getApiBaseUrl } from "@core/config/serverUrl";

export interface SerializedAgent {
  id: string;
  name: string;
  description: string;
  avatarEmoji: string;
  themeColor: string;
  avatarKey: string;
  isDefault: boolean;
  primaryModel: string;
  primaryProviderKeyId: string;
  imageModel: string;
  imageProviderKeyId: string;
  enabledTools: string[];
  /** Raw JSON blobs; parse with `parseModelParamValues` at the point of use. */
  modelParams: string;
  imageParams: string;
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
    primaryProviderKeyId: proto.primaryProviderKeyId,
    imageModel: proto.imageModel || "",
    imageProviderKeyId: proto.imageProviderKeyId || "",
    enabledTools: [...proto.enabledTools],
    modelParams: proto.modelParams || "",
    imageParams: proto.imageParams || "",
  };
}

/** Authenticated avatar image URL for an agent, when it has an uploaded image. */
export function agentAvatarUrl(
  organizationId: string,
  agentId: string,
  avatarKey: string,
): string | null {
  if (!avatarKey) return null;
  return `${getApiBaseUrl()}/agents/avatars/${organizationId}/${agentId}`;
}
