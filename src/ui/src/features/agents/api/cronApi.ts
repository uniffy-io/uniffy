import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { CronService } from '@uniffy/proto/agents/v1/cron_connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import type {
    CreateCronTaskRequest,
    GetCronTaskRequest,
    ListCronTasksRequest,
    UpdateCronTaskRequest,
    DeleteCronTaskRequest,
    ListCronRunLogsRequest,
    TriggerCronTaskRequest,
} from '@uniffy/proto/agents/v1/cron_pb';

const client = createClient(CronService, transport);

export const cronApi = {
    createCronTask: async (request: PartialMessage<CreateCronTaskRequest>) => {
        return client.createCronTask(request);
    },
    getCronTask: async (request: PartialMessage<GetCronTaskRequest>) => {
        return client.getCronTask(request);
    },
    listCronTasks: async (request: PartialMessage<ListCronTasksRequest>) => {
        return client.listCronTasks(request);
    },
    updateCronTask: async (request: PartialMessage<UpdateCronTaskRequest>) => {
        return client.updateCronTask(request);
    },
    deleteCronTask: async (request: PartialMessage<DeleteCronTaskRequest>) => {
        return client.deleteCronTask(request);
    },
    listCronRunLogs: async (request: PartialMessage<ListCronRunLogsRequest>) => {
        return client.listCronRunLogs(request);
    },
    triggerCronTask: async (request: PartialMessage<TriggerCronTaskRequest>) => {
        return client.triggerCronTask(request);
    },
};
