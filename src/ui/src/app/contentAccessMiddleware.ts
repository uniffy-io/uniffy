import type { Middleware } from "@reduxjs/toolkit";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import type { RootState } from "@/app/store";
import { removeChannel } from "@/features/chat/store/chatChannelsSlice";
import { emitContentAccessChanged } from "@/features/notifications/contentAccessEmitter";
import { fetchProjects } from "@/features/projects/store/projectsThunks";
import {
  clearSelection,
  closeDetailPanel,
  selectTask,
} from "@/features/projects/store/projectsUiSlice";

export const contentAccessMiddleware: Middleware<object, RootState> =
  ({ dispatch, getState }) =>
  (next) =>
  (action) => {
    const result = next(action);
    if (removeChannel.match(action)) {
      emitContentAccessChanged({
        contentType: ContentType.CHAT,
        contentId: action.payload,
        action: "revoked",
      });
    }
    if (fetchProjects.fulfilled.match(action)) {
      const { projects, projectsUi } = getState();
      if (projectsUi.selectedTaskId && !projects.tasks[projectsUi.selectedTaskId]) {
        dispatch(selectTask(null));
        dispatch(closeDetailPanel());
      }
      if (projectsUi.selectedTaskIds.some((id) => !projects.tasks[id])) {
        dispatch(clearSelection());
      }
    }
    return result;
  };
