import { MembersSection } from "@/features/admin/components/members/MembersSection";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";

export function MembersPage() {
  useDocumentTitle("Members");
  return <MembersSection />;
}
