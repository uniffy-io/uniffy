import { createClient } from "@connectrpc/connect";
import { transport } from "@/config/api";
import {
  FilesService,
  CreateSavedFilterRequestSchema,
  DeleteSavedFilterRequestSchema,
  GetSavedFilterRequestSchema,
  ListSavedFiltersRequestSchema,
  UpdateSavedFilterRequestSchema,
} from "@uniffy/proto/files/v1/files_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const filesClient = createClient(FilesService, transport);

export const savedFiltersApi = {
  createSavedFilter: async (request: MessageInitShape<typeof CreateSavedFilterRequestSchema>) => {
    return filesClient.createSavedFilter(request);
  },

  getSavedFilter: async (request: MessageInitShape<typeof GetSavedFilterRequestSchema>) => {
    return filesClient.getSavedFilter(request);
  },

  updateSavedFilter: async (request: MessageInitShape<typeof UpdateSavedFilterRequestSchema>) => {
    return filesClient.updateSavedFilter(request);
  },

  deleteSavedFilter: async (request: MessageInitShape<typeof DeleteSavedFilterRequestSchema>) => {
    return filesClient.deleteSavedFilter(request);
  },

  listSavedFilters: async (request: MessageInitShape<typeof ListSavedFiltersRequestSchema>) => {
    return filesClient.listSavedFilters(request);
  },
};
