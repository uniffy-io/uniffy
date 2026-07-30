import { IntegrationsSection } from '@/features/admin/components/integrations/IntegrationsSection';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

export function IntegrationsPage() {
    useDocumentTitle('Integrations');
    return <IntegrationsSection />;
}
