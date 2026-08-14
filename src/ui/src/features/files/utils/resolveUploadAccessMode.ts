import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import type { SerializedFolder } from "@/features/files/store/filesTreeThunks";

export type FilesViewScope = "all" | "personal" | "shared" | "organization";

export function resolveUploadAccessMode(
  viewScope: FilesViewScope,
  parentFolder?: SerializedFolder,
): AccessMode {
  if (parentFolder) return parentFolder.accessMode;
  if (viewScope === "organization") return AccessMode.OPEN_TO_ORG;
  return AccessMode.OWNER_ONLY;
}
