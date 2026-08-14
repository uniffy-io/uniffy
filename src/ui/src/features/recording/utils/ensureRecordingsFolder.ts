import { filesApi } from "@/features/files/api/filesApi";

export async function fetchRecordingsFolderId(organizationId: string): Promise<string> {
  const response = await filesApi.ensureRecordingsFolder({ organizationId });
  if (!response.folder) {
    throw new Error("Server did not return Recordings folder");
  }
  return response.folder.id;
}
