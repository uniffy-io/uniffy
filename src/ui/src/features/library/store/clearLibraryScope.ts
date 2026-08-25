import type { Dispatch } from "@reduxjs/toolkit";
import { clearBookmarks } from "@/features/bookmarks/store/bookmarksSlice";
import { clearContentGraph } from "@/features/library/store/graphSlice";
import { clearUrnMetadataCache } from "@/features/search/utils/urnMetadataCache";

export function clearLibraryScope(dispatch: Dispatch): void {
  dispatch(clearBookmarks());
  dispatch(clearContentGraph());
  clearUrnMetadataCache();
}
