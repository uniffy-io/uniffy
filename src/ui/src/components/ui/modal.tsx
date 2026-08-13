import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/utils/cn';

const ANIMATION_MS = 150;

// Escape must close only the topmost modal when dialogs stack.
const modalStack: symbol[] = [];

interface ModalProps {
  children: React.ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  maxWidth?: string;
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
  const stackIdRef = useRef(Symbol('modal'));

  useEffect(() => {
    const id = stackIdRef.current;
    modalStack.push(id);
    return () => {
      const index = modalStack.indexOf(id);
      if (index >= 0) modalStack.splice(index, 1);
    };
  }, []);

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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (modalStack[modalStack.length - 1] !== stackIdRef.current) return;
      requestClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [requestClose]);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const isVisible = phase === 'open';

  // Rendered through a portal: an ancestor's transform (e.g. another
  // Modal's scale transition) would otherwise become the containing
  // block for `fixed` and clip nested dialogs.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div
        className={cn(
          'absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-150',
          isVisible ? 'opacity-100' : 'opacity-0',
        )}
        onClick={requestClose}
      />

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
    </div>,
    document.body,
  );
}
