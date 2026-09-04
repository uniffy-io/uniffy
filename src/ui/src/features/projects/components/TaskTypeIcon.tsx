import { type IconProps } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { getTaskTypeConfig } from "@/features/projects/utils/taskTypes";

interface TaskTypeIconProps extends Omit<IconProps, "weight"> {
  type: string | undefined;
}

/** The one way to draw a task type. Duotone keeps the silhouette readable at 12 to 14px
 *  where fill turns into a blob, and the SVG title gives every glyph a hover label. */
export function TaskTypeIcon({ type, size = 14, className, ...props }: TaskTypeIconProps) {
  const config = getTaskTypeConfig(type || "task");
  const Glyph = config.icon;
  return (
    <Glyph size={size} weight="duotone" className={cn("shrink-0", className)} {...props}>
      <title>{config.label}</title>
    </Glyph>
  );
}
