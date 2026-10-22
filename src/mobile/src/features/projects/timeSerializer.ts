import { timestampDate } from "@bufbuild/protobuf/wkt";
import { WorklogSource, type Worklog } from "@uniffy/proto/projects/v1/time_pb";

export type SerializedWorklogSource = "manual" | "timer" | "import" | "agent";

export interface SerializedWorklog {
  id: string;
  taskId: string;
  projectId: string;
  userId: string;
  createdByUserId: string;
  /** YYYY-MM-DD in the worker's own zone. */
  workDate: string;
  durationMinutes: number;
  description: string;
  source: SerializedWorklogSource;
  createdAt: string;
}

const SOURCE: Record<WorklogSource, SerializedWorklogSource> = {
  [WorklogSource.UNSPECIFIED]: "manual",
  [WorklogSource.MANUAL]: "manual",
  [WorklogSource.TIMER]: "timer",
  [WorklogSource.IMPORT]: "import",
  [WorklogSource.AGENT]: "agent",
};

export function worklogToPlain(worklog: Worklog): SerializedWorklog {
  return {
    id: worklog.id,
    taskId: worklog.taskId,
    projectId: worklog.projectId,
    userId: worklog.userId,
    createdByUserId: worklog.createdByUserId,
    workDate: worklog.workDate,
    durationMinutes: worklog.durationMinutes,
    description: worklog.description,
    source: SOURCE[worklog.source] ?? "manual",
    createdAt: worklog.createdAt ? timestampDate(worklog.createdAt).toISOString() : "",
  };
}

/** The device's calendar day as YYYY-MM-DD; the server never derives a day from an instant. */
export function localDayKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
