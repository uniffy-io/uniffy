import { Users } from '@phosphor-icons/react';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import { AccessPolicyPanel } from '@/features/permissions';
import type { Project } from '@/features/projects/types/project';

interface MembersSectionProps {
    project: Project;
}

export function MembersSection({ project }: MembersSectionProps) {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
                    <Users size={24} weight="duotone" className="text-primary shrink-0" />
                    Access & Members
                </h1>
                <p className="text-muted-foreground">Control who can see and edit this project.</p>
            </div>
            <AccessPolicyPanel
                contentType={ContentType.PROJECT}
                contentId={project.id}
                contentTitle={project.name}
                explicitUserRole={project.userRole}
                showAuditLink
            />
        </div>
    );
}
