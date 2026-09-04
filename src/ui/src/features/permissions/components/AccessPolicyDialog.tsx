import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Modal, ModalBody, ModalHeader } from "@/components/ui/modal";
import { AccessPolicyPanel } from "@/features/permissions/components/AccessPolicyPanel";
import {
  AccessPolicyDialogContext,
  useAccessPolicyDialog,
  type AccessPolicyDialogContent,
  type AccessPolicyDialogContextValue,
} from "@/features/permissions/components/accessPolicyDialogContext";

export function AccessPolicyDialogProvider({ children }: { children: ReactNode }) {
  const [activeContent, setActiveContent] = useState<AccessPolicyDialogContent | null>(null);
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

  return (
    <AccessPolicyDialogContext.Provider value={value}>
      {children}
    </AccessPolicyDialogContext.Provider>
  );
}

export function AccessPolicyDialog() {
  const { isOpen, close, activeContent } = useAccessPolicyDialog();

  if (!isOpen || !activeContent) return null;

  return (
    <Modal onClose={close} maxWidth="max-w-xl">
      <ModalHeader
        title="Access"
        description={
          activeContent.title ? (
            <span className="block truncate">{activeContent.title}</span>
          ) : undefined
        }
        onClose={close}
      />

      <ModalBody>
        <AccessPolicyPanel
          contentType={activeContent.contentType}
          contentId={activeContent.contentId}
          contentTitle={activeContent.title}
          explicitUserRole={activeContent.explicitUserRole}
          showAuditLink
        />
      </ModalBody>
    </Modal>
  );
}
