import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { unaryTransport } from "@/config/api";
import {
  SkillEvaluationsService,
  CreateCaseRequestSchema,
  UpdateCaseRequestSchema,
  DeleteCaseRequestSchema,
  ListCasesRequestSchema,
  RunCaseRequestSchema,
  RunSuiteRequestSchema,
  ListRunsRequestSchema,
  GetRunRequestSchema,
} from "@uniffy/proto/agents/v1/skill_evaluations_pb";

const client = createClient(SkillEvaluationsService, unaryTransport);

export const skillEvaluationsApi = {
  createCase: (request: MessageInitShape<typeof CreateCaseRequestSchema>) =>
    client.createCase(request),
  updateCase: (request: MessageInitShape<typeof UpdateCaseRequestSchema>) =>
    client.updateCase(request),
  deleteCase: (request: MessageInitShape<typeof DeleteCaseRequestSchema>) =>
    client.deleteCase(request),
  listCases: (request: MessageInitShape<typeof ListCasesRequestSchema>) =>
    client.listCases(request),
  runCase: (request: MessageInitShape<typeof RunCaseRequestSchema>) => client.runCase(request),
  runSuite: (request: MessageInitShape<typeof RunSuiteRequestSchema>) => client.runSuite(request),
  listRuns: (request: MessageInitShape<typeof ListRunsRequestSchema>) => client.listRuns(request),
  getRun: (request: MessageInitShape<typeof GetRunRequestSchema>) => client.getRun(request),
};
