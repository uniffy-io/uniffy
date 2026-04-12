import { ClockCounterClockwise } from '@phosphor-icons/react';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import { AuditLogPanel } from '@/features/permissions';
import type { Project } from '@/features/projects/types/project';

interface AuditLogSectionProps {
    project: Project;
}

export function AuditLogSection({ project }: AuditLogSectionProps) {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
                    <ClockCounterClockwise size={24} weight="duotone" className="text-primary shrink-0" />
                    Access History
                </h1>
                <p className="text-muted-foreground">
                    Audit log of all access and membership changes for this project.
                </p>
            </div>
            <AuditLogPanel
                contentType={ContentType.PROJECT}
                contentId={project.id}
            />
        </div>
    );
}
