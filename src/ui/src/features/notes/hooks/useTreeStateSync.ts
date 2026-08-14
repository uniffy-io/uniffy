import { useEffect, useRef } from "react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { loadExpandedNodes, saveExpandedNodes } from "@/features/notes/utils/treeStateStorage";

const SET_EXPANDED_NODES_FROM_STORAGE = "notesTree/setExpandedNodesFromStorage";

export function useTreeStateSync() {
  const dispatch = useAppDispatch();
  const expandedNodes = useAppSelector((state) => state.notesTree.expandedNodes);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id);

  const hasLoadedRef = useRef(false);
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    if (!organizationId || !userId || hasLoadedRef.current) {
      return;
    }

    const savedNodes = loadExpandedNodes(organizationId, userId);
    if (savedNodes && savedNodes.length > 0) {
      dispatch({
        type: SET_EXPANDED_NODES_FROM_STORAGE,
        payload: savedNodes,
      });
    }

    hasLoadedRef.current = true;
  }, [dispatch, organizationId, userId]);

  useEffect(() => {
    if (!organizationId || !userId || !hasLoadedRef.current) {
      return;
    }

    const hash = expandedNodes.join(",");
    if (hash === lastSavedRef.current) {
      return;
    }

    lastSavedRef.current = hash;

    const timeoutId = setTimeout(() => {
      saveExpandedNodes(organizationId, userId, expandedNodes);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [expandedNodes, organizationId, userId]);
}

export const TREE_STATE_ACTIONS = {
  SET_EXPANDED_NODES_FROM_STORAGE,
};
