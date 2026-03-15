import { createClient } from "@connectrpc/connect";
import type { PartialMessage } from "@bufbuild/protobuf";
import { ProjectsService } from "@/gen/projects/v1/projects_connect";
import type {
  CreateProjectRequest,
  GetProjectRequest,
  UpdateProjectRequest,
  DeleteProjectRequest,
  ListProjectsRequest,
  CreateTaskRequest,
  GetTaskRequest,
  UpdateTaskRequest,
  DeleteTaskRequest,
  ListTasksRequest,
  MoveTaskRequest,
  ListActivitiesRequest,
} from "@/gen/projects/v1/projects_pb";
import { transport } from "@/lib/transport";

const client = createClient(ProjectsService, transport);

export const projectsApi = {
  listProjects: (request: PartialMessage<ListProjectsRequest>) => client.listProjects(request),

  getProject: (request: PartialMessage<GetProjectRequest>) => client.getProject(request),

  createProject: (request: PartialMessage<CreateProjectRequest>) => client.createProject(request),

  updateProject: (request: PartialMessage<UpdateProjectRequest>) => client.updateProject(request),

  deleteProject: (request: PartialMessage<DeleteProjectRequest>) => client.deleteProject(request),

  listTasks: (request: PartialMessage<ListTasksRequest>) => client.listTasks(request),

  getTask: (request: PartialMessage<GetTaskRequest>) => client.getTask(request),

  createTask: (request: PartialMessage<CreateTaskRequest>) => client.createTask(request),

  updateTask: (request: PartialMessage<UpdateTaskRequest>) => client.updateTask(request),

  deleteTask: (request: PartialMessage<DeleteTaskRequest>) => client.deleteTask(request),

  moveTask: (request: PartialMessage<MoveTaskRequest>) => client.moveTask(request),

  listActivities: (request: PartialMessage<ListActivitiesRequest>) =>
    client.listActivities(request),
};
