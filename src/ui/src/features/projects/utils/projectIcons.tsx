import {
  Kanban,
  Megaphone,
  Wrench,
  Rocket,
  Lightning,
  Globe,
  ShoppingCart,
  GraduationCap,
  Palette,
  Bug,
  Target,
  Trophy,
  Cube,
  Heart,
  Star,
  type IconProps,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";

export type ProjectIconName =
  | "kanban"
  | "megaphone"
  | "wrench"
  | "rocket"
  | "lightning"
  | "globe"
  | "cart"
  | "graduation"
  | "palette"
  | "bug"
  | "target"
  | "trophy"
  | "cube"
  | "heart"
  | "star";

const ICON_MAP: Record<ProjectIconName, ComponentType<IconProps>> = {
  kanban: Kanban,
  megaphone: Megaphone,
  wrench: Wrench,
  rocket: Rocket,
  lightning: Lightning,
  globe: Globe,
  cart: ShoppingCart,
  graduation: GraduationCap,
  palette: Palette,
  bug: Bug,
  target: Target,
  trophy: Trophy,
  cube: Cube,
  heart: Heart,
  star: Star,
};

interface ProjectIconProps extends IconProps {
  icon: string;
}

/** Falls back to Kanban when the icon name is not recognized. */
export function ProjectIcon({ icon, ...props }: ProjectIconProps) {
  const IconComponent = ICON_MAP[icon as ProjectIconName] || Kanban;
  return <IconComponent {...props} />;
}
