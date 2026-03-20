import { VisibilityScope } from '@uniffy/proto/common/v1/common_pb';

export interface EventTemplate {
    id: string;
    organizationId: string;
    title: string;
    description: string;
    durationMinutes: number;
    location: string;
    meetingUrl?: string;
    categoryId?: string;
    tags: string[];
    visibility: VisibilityScope;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateTemplatePayload {
    title: string;
    description?: string;
    durationMinutes: number;
    location?: string;
    meetingUrl?: string;
    categoryId?: string;
    tags?: string[];
    visibility?: VisibilityScope;
}

export interface UpdateTemplatePayload extends Partial<CreateTemplatePayload> {
    id: string;
}
