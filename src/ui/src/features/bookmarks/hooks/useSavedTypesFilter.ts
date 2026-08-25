import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  parseBookmarkTypesParam,
  serializeBookmarkTypesParam,
} from "@/features/bookmarks/utils/bookmarkTypes";
import type { UrnType } from "@/shared/utils/urnTypes";

/** URL-synced `?types=` filter for the saved-bookmarks surfaces. */
export function useSavedTypesFilter() {
  const [searchParams, setSearchParams] = useSearchParams();

  const typesParam = searchParams.get("types");
  const selected = useMemo(() => parseBookmarkTypesParam(typesParam), [typesParam]);

  const setSelected = useCallback(
    (types: UrnType[]) => {
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          if (types.length === 0) {
            next.delete("types");
          } else {
            next.set("types", serializeBookmarkTypesParam(types));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { selected, setSelected };
}
