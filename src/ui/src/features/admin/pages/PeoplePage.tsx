import { PlugsConnected } from '@phosphor-icons/react';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { ProfilePolicySection } from '@/features/admin/components/people/ProfilePolicySection';
import { IdentitySourcesSection } from '@/features/admin/components/people/IdentitySourcesSection';

export function PeoplePage() {
    useDocumentTitle('Directory');

    return (
        <div className="space-y-10 w-full">
            <div>
                <div className="flex items-center gap-3 mb-2">
                    <PlugsConnected size={24} weight="duotone" className="text-primary shrink-0" />
                    <h1 className="text-xl md:text-2xl font-bold">Directory</h1>
                </div>
                <p className="text-muted-foreground text-sm">
                    Where people and teams sync from, and which people surfaces members see.
                </p>
            </div>

            <IdentitySourcesSection />
            <ProfilePolicySection />
        </div>
    );
}
