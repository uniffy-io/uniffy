import { useEffect } from "react";
import { useAppDispatch } from "@/app/hooks";
import { setTaskNavigationOrder } from "@/features/projects/store/projectsUiSlice";

/** Hands the order a view shows its tasks in to the full task page; renders nothing. */
export function PublishTaskOrder({ orderKey }: { orderKey: string }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(setTaskNavigationOrder(orderKey ? orderKey.split(",") : []));
  }, [dispatch, orderKey]);
  // A view without a list order (roadmap, graph) must not inherit the previous view's.
  useEffect(() => () => void dispatch(setTaskNavigationOrder([])), [dispatch]);
  return null;
}
