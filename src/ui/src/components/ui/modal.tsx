/**
 * Modal - Shared animated modal wrapper.
 *
 * Provides enter/exit animations for backdrop and dialog content.
 * Handles escape key, backdrop click, and scroll locking.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { cn } from '@/shared/utils/cn';

const ANIMATION_MS = 150;

interface ModalProps {
  children: React.ReactNode;
  onClose: () => void;
  /** Prevent closing (e.g. while submitting) */
  closeDisabled?: boolean;
  /** Max width class for the dialog. Default: "max-w-lg" */
  maxWidth?: string;
  /** Additional classes for the dialog panel */
  className?: string;
}

export function Modal({
  children,
  onClose,
  closeDisabled = false,
  maxWidth = 'max-w-lg',
  className,
}: ModalProps) {
  const [phase, setPhase] = useState<'entering' | 'open' | 'exiting'>('entering');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Transition from entering -> open after mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setPhase('open');
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const requestClose = useCallback(() => {
    if (closeDisabled || phase === 'exiting') return;
    setPhase('exiting');
    timerRef.current = setTimeout(onClose, ANIMATION_MS);
  }, [closeDisabled, phase, onClose]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [requestClose]);

  // Lock body scroll
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const isVisible = phase === 'open';

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-150',
          isVisible ? 'opacity-100' : 'opacity-0',
        )}
        onClick={requestClose}
      />

      {/* Dialog */}
      <div
        className={cn(
          'relative bg-card w-[calc(100vw-2rem)] rounded-t-xl sm:rounded-xl shadow-2xl border border-border overflow-hidden',
          'transition-all duration-150 ease-out',
          isVisible
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 translate-y-2',
          maxWidth,
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
