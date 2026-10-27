import { AccessMode, ContentRole, ContentType } from "@uniffy/proto/common/v1/common_pb";
import type { RootState } from "@/app/store";

export type SharingPreset = "edit" | "comment" | "view";

export interface SharingOption {
  id: SharingPreset;
  role: ContentRole;
  title: string;
  body: string;
  level: number;
}

export const SHARING_OPTIONS: SharingOption[] = [
  {
    id: "edit",
    role: ContentRole.EDITOR,
    title: "Edit together",
    body: "Everyone can edit notes and projects shared with the whole organization.",
    level: 3,
  },
  {
    id: "comment",
    role: ContentRole.COMMENTER,
    title: "Read and comment",
    body: "Everyone can read and comment. Editing takes an invite from the owner.",
    level: 2,
  },
  {
    id: "view",
    role: ContentRole.VIEWER,
    title: "Read only",
    body: "Everyone can read. Commenting and editing take an invite from the owner.",
    level: 1,
  },
];

/** Shared notes and projects are where teams feel the difference; the other types keep theirs. */
export const SHARING_CONTENT_TYPES = [ContentType.NOTE, ContentType.PROJECT] as const;

/** A fresh organization seeds notes and projects as editable by everyone. */
export const DEFAULT_SHARING_PRESET: SharingPreset = "edit";

export function roleForPreset(preset: SharingPreset): ContentRole {
  return SHARING_OPTIONS.find((option) => option.id === preset)?.role ?? ContentRole.EDITOR;
}

/** A preset is current only when both shared content types use it. */
export const selectStoredSharingPreset = (state: RootState): SharingPreset | null => {
  return (
    SHARING_OPTIONS.find((option) =>
      SHARING_CONTENT_TYPES.every((contentType) =>
        state.admin.permissionDefaults.some(
          (entry) =>
            entry.contentType === contentType &&
            entry.defaultAccessMode === AccessMode.OPEN_TO_ORG &&
            entry.defaultBaselineRole === option.role,
        ),
      ),
    )?.id ?? null
  );
};
