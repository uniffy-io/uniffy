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
    const previousProjects = fetchProjects.fulfilled.match(action) ? getState().projects : null;
    const result = next(action);
    if (removeChannel.match(action)) {
      emitContentAccessChanged({
        contentType: ContentType.CHAT,
        contentId: action.payload,
        action: "revoked",
      });
    }
    if (previousProjects) {
      const { projects, projectsUi } = getState();
      const removedTask = (id: string) => previousProjects.tasks[id] && !projects.tasks[id];
      const lostCurrentProject =
        previousProjects.currentProjectId && !projects.projects[previousProjects.currentProjectId];
      // A linked task can still be loading when the project list refresh completes.
      if (
        projectsUi.selectedTaskId &&
        (removedTask(projectsUi.selectedTaskId) || lostCurrentProject)
      ) {
        dispatch(selectTask(null));
        dispatch(closeDetailPanel());
      }
      if (projectsUi.selectedTaskIds.some(removedTask) || lostCurrentProject) {
        dispatch(clearSelection());
      }
    }
    return result;
  };
