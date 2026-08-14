import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import {
  CronService,
  CreateCronTaskRequestSchema,
  GetCronTaskRequestSchema,
  ListCronTasksRequestSchema,
  UpdateCronTaskRequestSchema,
  DeleteCronTaskRequestSchema,
  ListCronRunLogsRequestSchema,
  TriggerCronTaskRequestSchema,
} from "@uniffy/proto/agents/v1/cron_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const client = createClient(CronService, unaryTransport);

export const cronApi = {
  createCronTask: async (request: MessageInitShape<typeof CreateCronTaskRequestSchema>) => {
    return client.createCronTask(request);
  },
  getCronTask: async (request: MessageInitShape<typeof GetCronTaskRequestSchema>) => {
    return client.getCronTask(request);
  },
  listCronTasks: async (request: MessageInitShape<typeof ListCronTasksRequestSchema>) => {
    return client.listCronTasks(request);
  },
  updateCronTask: async (request: MessageInitShape<typeof UpdateCronTaskRequestSchema>) => {
    return client.updateCronTask(request);
  },
  deleteCronTask: async (request: MessageInitShape<typeof DeleteCronTaskRequestSchema>) => {
    return client.deleteCronTask(request);
  },
  listCronRunLogs: async (request: MessageInitShape<typeof ListCronRunLogsRequestSchema>) => {
    return client.listCronRunLogs(request);
  },
  triggerCronTask: async (request: MessageInitShape<typeof TriggerCronTaskRequestSchema>) => {
    return client.triggerCronTask(request);
  },
};
