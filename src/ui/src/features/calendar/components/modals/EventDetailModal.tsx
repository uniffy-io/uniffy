/**
 * EventDetailModal - Centered modal wrapper for the event DetailPanel.
 *
 * Renders the same DetailPanel content in a centered overlay instead
 * of the right sidebar. Used when the user prefers modal view mode.
 */

import { useEffect, useCallback } from 'react';
import { useAppDispatch } from '@/app/hooks';
import { closeDetailPanel } from '@/features/calendar/store';
import { DetailPanel } from '@/features/calendar/components/layout/DetailPanel';

export function EventDetailModal() {
  const dispatch = useAppDispatch();

  const handleClose = useCallback(() => {
    dispatch(closeDetailPanel());
  }, [dispatch]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') handleClose();
  }, [handleClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-card w-[calc(100vw-2rem)] max-w-3xl rounded-t-xl sm:rounded-xl shadow-2xl border border-border overflow-hidden max-h-[85vh] flex flex-col">
        <DetailPanel />
      </div>
    </div>
  );
}
