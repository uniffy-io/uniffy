import { Archive, ChartLine, Columns, ShareNetwork, Table, Users } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { ViewType } from "@/features/projects/types/views";

export interface ViewTypeOption {
  type: ViewType;
  label: string;
  icon: ReactNode;
}

/** Every layout a view can have, in the order a new-view picker offers them. */
export const VIEW_TYPE_OPTIONS: readonly ViewTypeOption[] = [
  { type: "table", label: "Table", icon: <Table size={16} /> },
  { type: "board", label: "Board", icon: <Columns size={16} /> },
  { type: "roadmap", label: "Roadmap", icon: <ChartLine size={16} /> },
  { type: "backlog", label: "Backlog", icon: <Archive size={16} /> },
  { type: "graph", label: "Graph", icon: <ShareNetwork size={16} /> },
  { type: "resources", label: "Resources", icon: <Users size={16} /> },
];

export const VIEW_TYPE_ICONS = Object.fromEntries(
  VIEW_TYPE_OPTIONS.map((option) => [option.type, option.icon]),
) as Record<ViewType, ReactNode>;
