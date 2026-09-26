import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { selectViewCatalog } from "@/features/projects/store/projectsSlice";
import { fetchViewCatalog } from "@/features/projects/store/projectsThunks";
import type { ViewCatalog } from "@/features/projects/types";

/** Null until the first fetch lands; the thunk's condition keeps it to one request a session. */
export function useViewCatalog(): ViewCatalog | null {
  const dispatch = useAppDispatch();
  const catalog = useAppSelector(selectViewCatalog);
  useEffect(() => {
    if (!catalog) void dispatch(fetchViewCatalog());
  }, [catalog, dispatch]);
  return catalog;
}
