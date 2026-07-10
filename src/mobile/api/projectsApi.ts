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
} from "@uniffy/proto/projects/v1/projects_pb";
import { transport } from "@/lib/transport";

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

  listActivities: (request: MessageInitShape<typeof ListActivitiesRequestSchema>) =>
    client.listActivities(request),
};
