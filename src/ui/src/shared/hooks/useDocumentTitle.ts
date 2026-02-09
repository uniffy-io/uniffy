import { useEffect } from 'react';

const APP_NAME = 'Uniffy';

/**
 * Custom hook to set the document title following industry standards.
 *
 * Format: "{Title} | Uniffy" (content first, brand last)
 *
 *
 * @param title - The page/content title. If not provided, shows just "Uniffy"
 *
 * @example
 * ```tsx
 * // Static page title
 * useDocumentTitle('Notes');
 * // Result: "Notes | Uniffy"
 *
 * // Dynamic content title
 * useDocumentTitle(note?.title || 'Notes');
 * // Result: "My Note Title | Uniffy" or "Notes | Uniffy"
 *
 * // No title (home page)
 * useDocumentTitle();
 * // Result: "Uniffy"
 * ```
 */
export function useDocumentTitle(title?: string): void {
    useEffect(() => {
        const previousTitle = document.title;

        if (title) {
            document.title = `${title} | ${APP_NAME}`;
        } else {
            document.title = APP_NAME;
        }

        // Cleanup: restore previous title when component unmounts
        return () => {
            document.title = previousTitle;
        };
    }, [title]);
}
