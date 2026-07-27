import { MessageRole } from '@uniffy/proto/agents/v1/sessions_pb';
import type { SerializedMessage } from '@/features/agents/store/agentMessagesSerde';
import type { ToolStep } from '@/features/agents/components/ToolActivityPane';
import type { ThinkingBlockView } from '@/features/agents/utils/thinkingBlocks';
import { TOOL_SECTIONS } from '@/features/agents/config/toolCatalog';

const TOOL_DISPLAY_NAMES: Record<string, string> = {};
for (const section of TOOL_SECTIONS) {
    for (const group of section.groups) {
        for (const tool of group.tools) {
            TOOL_DISPLAY_NAMES[tool.name] = tool.displayName;
        }
    }
}

export function toolActionLabel(toolName: string): string {
    const display = TOOL_DISPLAY_NAMES[toolName];
    if (display) return display;
    const parts = toolName.split('.');
    const action = parts[parts.length - 1];
    return action
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

const TOOL_FAILURE_RE = /^(Error|Permission denied|Not found|Validation error)/i;

export function toolMessagesToSteps(messages: readonly SerializedMessage[]): ToolStep[] {
    return messages.map((msg) => {
        const toolName = msg.toolName ?? '';
        const result = msg.toolResult ?? '';
        return {
            id: msg.id,
            toolName,
            label: toolActionLabel(toolName),
            args: msg.toolArgsJson,
            result: result || undefined,
            status: TOOL_FAILURE_RE.test(result) ? 'failed' : 'completed',
        };
    });
}

export interface StreamingToolCallView {
    toolCallId: string;
    toolName: string;
    toolArgsJson: string;
    result?: string;
    success?: boolean;
}

export function streamingToolCallsToSteps(toolCalls: readonly StreamingToolCallView[]): ToolStep[] {
    return toolCalls.map((tc) => {
        const done = tc.result !== undefined;
        return {
            id: tc.toolCallId,
            toolName: tc.toolName,
            label: toolActionLabel(tc.toolName),
            args: tc.toolArgsJson,
            result: tc.result || undefined,
            status: !done ? 'running' : tc.success === false ? 'failed' : 'completed',
        };
    });
}

export type MessageTurn =
    | { kind: 'user'; message: SerializedMessage }
    | { kind: 'tools'; key: string; steps: ToolStep[] }
    | { kind: 'assistant'; message: SerializedMessage; thinking: ThinkingBlockView[] };

export function foldMessageTurns(
    messages: readonly SerializedMessage[],
    thinkingByMessage: Record<string, ThinkingBlockView[]>,
): MessageTurn[] {
    const turns: MessageTurn[] = [];
    let i = 0;
    while (i < messages.length) {
        const message = messages[i];
        if (message.role === MessageRole.USER) {
            turns.push({ kind: 'user', message });
            i++;
        } else if (message.role === MessageRole.TOOL) {
            const group: SerializedMessage[] = [];
            while (i < messages.length && messages[i].role === MessageRole.TOOL) {
                group.push(messages[i]);
                i++;
            }
            turns.push({ kind: 'tools', key: group[0].id, steps: toolMessagesToSteps(group) });
        } else {
            // Intermediate tool-loop assistant rows (toolCallId set) repeat the
            // preamble before each call, so only the concluding reply renders.
            if (!message.toolCallId) {
                turns.push({
                    kind: 'assistant',
                    message,
                    thinking: thinkingByMessage[message.id] ?? [],
                });
            }
            i++;
        }
    }
    return turns;
}
