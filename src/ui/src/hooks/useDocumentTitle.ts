import { useEffect } from 'react';

/**
 * Custom hook to set the document title
 * @param title - The page title (will be prefixed with "UNIFFY - ")
 * 
 * @example
 * ```tsx
 * function MyPage() {
 *   useDocumentTitle('Notes');
 *   // Document title will be "UNIFFY - Notes"
 *   return <div>...</div>;
 * }
 * ```
 */
export function useDocumentTitle(title?: string): void {
    useEffect(() => {
        const previousTitle = document.title;

        if (title) {
            document.title = `UNIFFY - ${title}`;
        } else {
            document.title = 'UNIFFY';
        }

        // Cleanup: restore previous title when component unmounts
        return () => {
            document.title = previousTitle;
        };
    }, [title]);
}
