import { useState, useCallback, useRef } from 'react';
import type { SearchResultItem } from '@uniffy/proto/search/v1/search_pb';
import { sanitizeMentionLabel } from '@/shared/utils/mentionUtils';

interface UseTextareaMentionOptions {
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    value: string;
    onChange: (value: string) => void;
}

interface UseTextareaMentionResult {
    isActive: boolean;
    mentionQuery: string;
    handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
    handleSelect: (result: SearchResultItem) => void;
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
        textareaRef.current?.focus();
    }, [textareaRef]);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const newValue = e.target.value;
            onChange(newValue);

            if (isActive) return;

            const cursorPos = e.target.selectionStart ?? newValue.length;
            const textBeforeCursor = newValue.slice(0, cursorPos);

            const lastAtIndex = textBeforeCursor.lastIndexOf('@');
            if (lastAtIndex === -1) return;

            // @ must be preceded by whitespace, newline, or start-of-string
            const charBefore = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : null;
            if (charBefore !== null && charBefore !== ' ' && charBefore !== '\n' && charBefore !== '\t') {
                return;
            }

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
            // Block Enter (send) while the mention popup is open
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
            const mentionString = `[[[${sanitizeMentionLabel(result.title)}|${result.urn}]]]`;
            const startIndex = mentionStartRef.current;
            if (startIndex === -1) return;

            const endIndex = cursorPosRef.current !== -1 ? cursorPosRef.current : value.length;
            const newValue =
                value.slice(0, startIndex) + mentionString + ' ' + value.slice(endIndex);
            onChange(newValue);

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
