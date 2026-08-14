import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, ShareNetwork } from "@phosphor-icons/react";
import { AccessPolicyPanel } from "@/features/permissions/components/AccessPolicyPanel";

interface ActiveContent {
  contentType: number;
  contentId: string;
  title?: string;
  explicitUserRole?: number | null;
}

interface AccessPolicyDialogContextValue {
  openFor: (
    contentType: number,
    contentId: string,
    title?: string,
    explicitUserRole?: number | null,
  ) => void;
  close: () => void;
  activeContent: ActiveContent | null;
  isOpen: boolean;
}

const Ctx = createContext<AccessPolicyDialogContextValue | null>(null);

export function AccessPolicyDialogProvider({ children }: { children: ReactNode }) {
  const [activeContent, setActiveContent] = useState<ActiveContent | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const openFor = useCallback(
    (contentType: number, contentId: string, title?: string, explicitUserRole?: number | null) => {
      setActiveContent({ contentType, contentId, title, explicitUserRole });
      setIsOpen(true);
    },
    [],
  );

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const value = useMemo<AccessPolicyDialogContextValue>(
    () => ({ openFor, close, activeContent, isOpen }),
    [openFor, close, activeContent, isOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is co-located with its provider
export function useAccessPolicyDialog(): AccessPolicyDialogContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useAccessPolicyDialog must be used within AccessPolicyDialogProvider");
  }
  return ctx;
}

export function AccessPolicyDialog() {
  const { isOpen, close, activeContent } = useAccessPolicyDialog();

  if (!activeContent) return null;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={close}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:scale-95 sm:translate-y-0"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:scale-95 sm:translate-y-0"
            >
              <Dialog.Panel className="w-full sm:w-[calc(100vw-2rem)] sm:max-w-xl transform overflow-hidden rounded-t-xl sm:rounded-xl bg-card border border-border shadow-xl transition-all">
                <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <ShareNetwork size={20} weight="duotone" className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <Dialog.Title className="text-lg font-semibold">Access</Dialog.Title>
                      {activeContent.title && (
                        <p className="text-sm text-muted-foreground truncate max-w-[280px]">
                          {activeContent.title}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={close}
                    className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    aria-label="Close"
                  >
                    <X size={20} weight="bold" />
                  </button>
                </div>

                <div className="px-4 md:px-6 py-4 max-h-[70vh] overflow-y-auto">
                  <AccessPolicyPanel
                    contentType={activeContent.contentType}
                    contentId={activeContent.contentId}
                    contentTitle={activeContent.title}
                    explicitUserRole={activeContent.explicitUserRole}
                    showAuditLink
                  />
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
