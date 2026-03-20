/**
 * Hook for @ mention detection and insertion in a plain textarea.
 *
 * Detects when the user types @ (preceded by whitespace or start-of-string),
 * opens a Spotlight-style search popup. On selection, inserts the
 * [[[label|urn]]] mention syntax into the textarea value.
 */

import { useState, useCallback, useRef } from 'react';
import type { SearchResultItem } from '@uniffy/proto/search/v1/search_pb';

interface UseTextareaMentionOptions {
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    value: string;
    onChange: (value: string) => void;
}

interface UseTextareaMentionResult {
    /** Whether the mention popup is open */
    isActive: boolean;
    /** Text typed after @ (used as initial query for the popup) */
    mentionQuery: string;
    /** Textarea onChange handler (detects @ triggers) */
    handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    /** Textarea onKeyDown handler (blocks Enter while popup open) */
    handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
    /** Called when user selects a result from the popup */
    handleSelect: (result: SearchResultItem) => void;
    /** Close the popup without inserting */
    close: () => void;
}

export function useTextareaMention({
    textareaRef,
    value,
    onChange,
}: UseTextareaMentionOptions): UseTextareaMentionResult {
    const [isActive, setIsActive] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const mentionStartRef = useRef(-1);
    const cursorPosRef = useRef(-1);

    const close = useCallback(() => {
        setIsActive(false);
        setMentionQuery('');
        mentionStartRef.current = -1;
        cursorPosRef.current = -1;
        // Return focus to the textarea
        textareaRef.current?.focus();
    }, [textareaRef]);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const newValue = e.target.value;
            onChange(newValue);

            // Don't re-trigger while popup is already open
            if (isActive) return;

            const cursorPos = e.target.selectionStart ?? newValue.length;
            const textBeforeCursor = newValue.slice(0, cursorPos);

            // Find the last @ before the cursor
            const lastAtIndex = textBeforeCursor.lastIndexOf('@');
            if (lastAtIndex === -1) return;

            // Validate: @ must be preceded by whitespace, newline, or be at start
            const charBefore = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : null;
            if (charBefore !== null && charBefore !== ' ' && charBefore !== '\n' && charBefore !== '\t') {
                return;
            }

            // Extract query (text between @ and cursor)
            const query = textBeforeCursor.slice(lastAtIndex + 1);
            if (query.includes('\n')) return;

            mentionStartRef.current = lastAtIndex;
            cursorPosRef.current = cursorPos;
            setMentionQuery(query);
            setIsActive(true);
        },
        [onChange, isActive],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
            // Block Enter from sending the message while popup is open
            if (!isActive) return false;
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                return true;
            }
            return false;
        },
        [isActive],
    );

    const handleSelect = useCallback(
        (result: SearchResultItem) => {
            const mentionString = `[[[${result.title}|${result.urn}]]]`;
            const startIndex = mentionStartRef.current;
            if (startIndex === -1) return;

            // Replace from @ to the cursor position when popup opened
            const endIndex = cursorPosRef.current !== -1 ? cursorPosRef.current : value.length;
            const newValue =
                value.slice(0, startIndex) + mentionString + ' ' + value.slice(endIndex);
            onChange(newValue);

            // Reposition cursor after the inserted mention
            const textarea = textareaRef.current;
            const newCursorPos = startIndex + mentionString.length + 1;
            requestAnimationFrame(() => {
                textarea?.setSelectionRange(newCursorPos, newCursorPos);
                textarea?.focus();
            });

            setIsActive(false);
            setMentionQuery('');
            mentionStartRef.current = -1;
            cursorPosRef.current = -1;
        },
        [value, onChange, textareaRef],
    );

    return {
        isActive,
        mentionQuery,
        handleChange,
        handleKeyDown,
        handleSelect,
        close,
    };
}
