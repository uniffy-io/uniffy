import { AccessMode } from "@uniffy/proto/common/v1/common_pb";

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
  visibility: AccessMode;
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
  visibility?: AccessMode;
}

export interface UpdateTemplatePayload extends Partial<CreateTemplatePayload> {
  id: string;
}
