import { useState, useCallback, useRef } from 'react';

interface UseTextareaSlashOptions {
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    value: string;
    onChange: (value: string) => void;
}

interface UseTextareaSlashResult {
    isActive: boolean;
    slashQuery: string;
    handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
    clearSlashToken: () => void;
    close: () => void;
}

// Detect a "/skill" typeahead token immediately before the cursor. Returns the
// token start index and the partial query, or null when no token is open. The
// "/" must sit at start-of-input or after whitespace, and the query must be a
// single whitespace-free run (skill names are single tokens).
export function computeSlashToken(
    textBeforeCursor: string,
): { start: number; query: string } | null {
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
    if (lastSlashIndex === -1) return null;

    const charBefore = lastSlashIndex > 0 ? textBeforeCursor[lastSlashIndex - 1] : null;
    if (charBefore !== null && !/\s/.test(charBefore)) return null;

    const query = textBeforeCursor.slice(lastSlashIndex + 1);
    if (/\s/.test(query)) return null;

    return { start: lastSlashIndex, query };
}

// Tracks a "/skill" typeahead token in a textarea. Unlike the @-mention modal,
// the slash menu is an inline typeahead: the query follows the textarea live and
// the popup closes the moment the token is broken (whitespace typed or "/" gone).
export function useTextareaSlash({
    textareaRef,
    value,
    onChange,
}: UseTextareaSlashOptions): UseTextareaSlashResult {
    const [isActive, setIsActive] = useState(false);
    const [slashQuery, setSlashQuery] = useState('');
    const slashStartRef = useRef(-1);
    const cursorPosRef = useRef(-1);

    const reset = useCallback(() => {
        setIsActive(false);
        setSlashQuery('');
        slashStartRef.current = -1;
        cursorPosRef.current = -1;
    }, []);

    const close = useCallback(() => {
        reset();
        textareaRef.current?.focus();
    }, [reset, textareaRef]);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const newValue = e.target.value;
            onChange(newValue);

            const cursorPos = e.target.selectionStart ?? newValue.length;
            const token = computeSlashToken(newValue.slice(0, cursorPos));
            if (token === null) {
                if (isActive) reset();
                return;
            }

            slashStartRef.current = token.start;
            cursorPosRef.current = cursorPos;
            setSlashQuery(token.query);
            setIsActive(true);
        },
        [onChange, isActive, reset],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
            // Block Enter (send) while the menu is open; the popup's own key
            // listener turns that Enter into a selection.
            if (!isActive) return false;
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                return true;
            }
            return false;
        },
        [isActive],
    );

    // Remove the typed "/query" from the text on selection (the chosen skill is
    // surfaced as a chip instead of inline text).
    const clearSlashToken = useCallback(() => {
        const startIndex = slashStartRef.current;
        const endIndex = cursorPosRef.current;
        if (startIndex !== -1 && endIndex !== -1) {
            const newValue = value.slice(0, startIndex) + value.slice(endIndex);
            onChange(newValue);
            const textarea = textareaRef.current;
            requestAnimationFrame(() => {
                textarea?.setSelectionRange(startIndex, startIndex);
                textarea?.focus();
            });
        }
        reset();
    }, [value, onChange, textareaRef, reset]);

    return {
        isActive,
        slashQuery,
        handleChange,
        handleKeyDown,
        clearSlashToken,
        close,
    };
}
