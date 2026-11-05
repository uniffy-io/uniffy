import { getServerUrl } from "@core/config/serverUrl";
import { getAuthGeneration } from "@core/auth/sessionEvents";
import { chatApi } from "@features/chat/chatApi";
import {
  preparePendingSend,
  forgetPendingSend,
  type SendRequest,
  type PendingSend,
} from "@features/chat/pendingSends";

const sending = new Map<string, ReturnType<typeof chatApi.sendMessage>>();
export async function deliverSend(
  userId: string,
  organizationId: string,
  request: SendRequest,
  prepared?: (pending: PendingSend) => void,
) {
  const generation = getAuthGeneration();
  const server = getServerUrl();
  const pending = await preparePendingSend(userId, organizationId, request);
  request.clientMessageId = pending.request.clientMessageId;
  if (generation !== getAuthGeneration() || server !== getServerUrl())
    throw new Error("Session changed");
  prepared?.(pending);
  const sendKey = `${pending.key}:${pending.request.clientMessageId}`;
  let sendingRequest = sending.get(sendKey);
  if (!sendingRequest) {
    sendingRequest = chatApi.sendMessage({ organizationId, ...pending.request });
    sending.set(sendKey, sendingRequest);
    void sendingRequest.then(
      () => sending.delete(sendKey),
      () => sending.delete(sendKey),
    );
  }
  const response = await sendingRequest;
  if (!response.message) throw new Error("Message confirmation unavailable");
  await forgetPendingSend(pending).catch(() => {});
  return response;
}
