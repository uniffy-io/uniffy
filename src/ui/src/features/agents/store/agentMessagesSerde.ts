import type { MessageInfo } from '@uniffy/proto/agents/v1/sessions_pb';

const timestampToPlain = (ts?: { seconds: bigint | number; nanos: bigint | number }) => {
    if (!ts) return undefined;
    return {
        seconds: typeof ts.seconds === 'bigint' ? Number(ts.seconds) : ts.seconds,
        nanos: typeof ts.nanos === 'bigint' ? Number(ts.nanos) : ts.nanos,
    };
};

export const messageToPlain = (msg: MessageInfo) => ({
    id: msg.id,
    sessionId: msg.sessionId,
    role: msg.role,
    content: msg.content,
    inputTokens: msg.inputTokens,
    outputTokens: msg.outputTokens,
    cacheCreationInputTokens: msg.cacheCreationInputTokens,
    cacheReadInputTokens: msg.cacheReadInputTokens,
    model: msg.model,
    toolName: msg.toolName,
    toolCallId: msg.toolCallId,
    toolArgsJson: msg.toolArgsJson,
    toolResult: msg.toolResult,
    isThinking: msg.isThinking,
    isCompacted: msg.isCompacted,
    createdAt: timestampToPlain(msg.createdAt),
    fileIds: msg.fileIds?.length ? [...msg.fileIds] : undefined,
    isInvalidated: msg.isInvalidated,
    editedAt: timestampToPlain(msg.editedAt),
    previousContent: msg.previousContent,
    wasCancelled: msg.wasCancelled,
    feedbackRating: msg.feedbackRating || '',
    invokedSkillName: msg.invokedSkillName || '',
    thinkingJson: msg.thinkingJson || '',
});

export type SerializedMessage = ReturnType<typeof messageToPlain>;
