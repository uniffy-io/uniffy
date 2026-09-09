import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { unaryTransport } from "@/config/api";
import {
  SkillEvaluationsService,
  CreateEvaluationCaseRequestSchema,
  UpdateEvaluationCaseRequestSchema,
  DeleteEvaluationCaseRequestSchema,
  ListEvaluationCasesRequestSchema,
  RunSkillEvaluationRequestSchema,
  ListEvaluationRunsRequestSchema,
  GetEvaluationRunRequestSchema,
} from "@uniffy/proto/agents/v1/skill_evaluations_pb";

const client = createClient(SkillEvaluationsService, unaryTransport);

export const skillEvaluationsApi = {
  createCase: (request: MessageInitShape<typeof CreateEvaluationCaseRequestSchema>) =>
    client.createCase(request),
  updateCase: (request: MessageInitShape<typeof UpdateEvaluationCaseRequestSchema>) =>
    client.updateCase(request),
  deleteCase: (request: MessageInitShape<typeof DeleteEvaluationCaseRequestSchema>) =>
    client.deleteCase(request),
  listCases: (request: MessageInitShape<typeof ListEvaluationCasesRequestSchema>) =>
    client.listCases(request),
  runCase: (request: MessageInitShape<typeof RunSkillEvaluationRequestSchema>) =>
    client.runCase(request),
  runSuite: (request: MessageInitShape<typeof RunSkillEvaluationRequestSchema>) =>
    client.runSuite(request),
  listRuns: (request: MessageInitShape<typeof ListEvaluationRunsRequestSchema>) =>
    client.listRuns(request),
  getRun: (request: MessageInitShape<typeof GetEvaluationRunRequestSchema>) =>
    client.getRun(request),
};
