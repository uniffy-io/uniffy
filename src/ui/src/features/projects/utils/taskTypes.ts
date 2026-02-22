import {
  CheckSquare,
  Bug,
  Star,
  BookOpen,
  Lightning,
  type Icon,
} from "@phosphor-icons/react";

export interface TaskTypeConfig {
  value: string;
  label: string;
  icon: Icon;
  description: string;
}

export const TASK_TYPES: TaskTypeConfig[] = [
  {
    value: "task",
    label: "Task",
    icon: CheckSquare,
    description: "A standard work item",
  },
  {
    value: "bug",
    label: "Bug",
    icon: Bug,
    description: "A defect or problem to fix",
  },
  {
    value: "feature",
    label: "Feature",
    icon: Star,
    description: "A new capability or enhancement",
  },
  {
    value: "story",
    label: "Story",
    icon: BookOpen,
    description: "A user story or requirement",
  },
  {
    value: "epic",
    label: "Epic",
    icon: Lightning,
    description: "A large body of work",
  },
];

export const TASK_TYPE_MAP = new Map(
  TASK_TYPES.map((t) => [t.value, t])
);

export function getTaskTypeConfig(value: string): TaskTypeConfig {
  return TASK_TYPE_MAP.get(value) ?? TASK_TYPES[0];
}
