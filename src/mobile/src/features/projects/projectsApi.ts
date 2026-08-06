import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  ProjectsService,
  CreateProjectRequestSchema,
  CreateTaskRequestSchema,
  DeleteProjectRequestSchema,
  DeleteTaskRequestSchema,
  GetProjectRequestSchema,
  GetTaskRequestSchema,
  ListActivitiesRequestSchema,
  ListProjectsRequestSchema,
  ListTasksRequestSchema,
  MoveTaskRequestSchema,
  UpdateProjectRequestSchema,
  UpdateTaskRequestSchema,
  CompleteSprintRequestSchema,
  CreateSprintRequestSchema,
  DeleteSprintRequestSchema,
  ListSprintsRequestSchema,
  StartSprintRequestSchema,
  BulkUpdateTasksRequestSchema,
  UpdateFieldRequestSchema,
  DeleteTasksRequestSchema,
  ToggleTaskWatcherRequestSchema,
  ListTaskWatchersRequestSchema,
} from "@uniffy/proto/projects/v1/projects_pb";
import { transport } from "@core/api/transport";

const client = createClient(ProjectsService, transport);

export const projectsApi = {
  listProjects: (request: MessageInitShape<typeof ListProjectsRequestSchema>) =>
    client.listProjects(request),

  getProject: (request: MessageInitShape<typeof GetProjectRequestSchema>) =>
    client.getProject(request),

  createProject: (request: MessageInitShape<typeof CreateProjectRequestSchema>) =>
    client.createProject(request),

  updateProject: (request: MessageInitShape<typeof UpdateProjectRequestSchema>) =>
    client.updateProject(request),

  deleteProject: (request: MessageInitShape<typeof DeleteProjectRequestSchema>) =>
    client.deleteProject(request),

  listTasks: (request: MessageInitShape<typeof ListTasksRequestSchema>) =>
    client.listTasks(request),

  getTask: (request: MessageInitShape<typeof GetTaskRequestSchema>) => client.getTask(request),

  createTask: (request: MessageInitShape<typeof CreateTaskRequestSchema>) =>
    client.createTask(request),

  updateTask: (request: MessageInitShape<typeof UpdateTaskRequestSchema>) =>
    client.updateTask(request),

  deleteTask: (request: MessageInitShape<typeof DeleteTaskRequestSchema>) =>
    client.deleteTask(request),

  moveTask: (request: MessageInitShape<typeof MoveTaskRequestSchema>) => client.moveTask(request),

  bulkUpdateTasks: (request: MessageInitShape<typeof BulkUpdateTasksRequestSchema>) =>
    client.bulkUpdateTasks(request),

  updateField: (request: MessageInitShape<typeof UpdateFieldRequestSchema>) =>
    client.updateField(request),

  deleteTasks: (request: MessageInitShape<typeof DeleteTasksRequestSchema>) =>
    client.deleteTasks(request),

  toggleTaskWatcher: (request: MessageInitShape<typeof ToggleTaskWatcherRequestSchema>) =>
    client.toggleTaskWatcher(request),

  listTaskWatchers: (request: MessageInitShape<typeof ListTaskWatchersRequestSchema>) =>
    client.listTaskWatchers(request),

  listActivities: (request: MessageInitShape<typeof ListActivitiesRequestSchema>) =>
    client.listActivities(request),

  listSprints: (request: MessageInitShape<typeof ListSprintsRequestSchema>) =>
    client.listSprints(request),

  createSprint: (request: MessageInitShape<typeof CreateSprintRequestSchema>) =>
    client.createSprint(request),

  startSprint: (request: MessageInitShape<typeof StartSprintRequestSchema>) =>
    client.startSprint(request),

  completeSprint: (request: MessageInitShape<typeof CompleteSprintRequestSchema>) =>
    client.completeSprint(request),

  deleteSprint: (request: MessageInitShape<typeof DeleteSprintRequestSchema>) =>
    client.deleteSprint(request),
};
