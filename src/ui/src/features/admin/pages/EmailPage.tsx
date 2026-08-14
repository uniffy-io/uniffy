import { EmailSection } from "@/features/admin/components/email/EmailSection";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";

export function EmailPage() {
  useDocumentTitle("Email");
  return <EmailSection />;
}
