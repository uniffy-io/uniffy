import { EncryptionSection } from '@/features/admin/components/encryption/EncryptionSection';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

export function EncryptionPage() {
    useDocumentTitle('Encryption');
    return <EncryptionSection />;
}
