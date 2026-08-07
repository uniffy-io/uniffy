import React from "react";
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
} from "phosphor-react-native";
import type { IconProps } from "phosphor-react-native";

/** Same set and same order as the web app's `utils/projectIcons.tsx`. */
export const PROJECT_ICONS: { name: string; Component: React.ComponentType<IconProps> }[] = [
  { name: "kanban", Component: Kanban },
  { name: "megaphone", Component: Megaphone },
  { name: "wrench", Component: Wrench },
  { name: "rocket", Component: Rocket },
  { name: "lightning", Component: Lightning },
  { name: "globe", Component: Globe },
  { name: "cart", Component: ShoppingCart },
  { name: "graduation", Component: GraduationCap },
  { name: "palette", Component: Palette },
  { name: "bug", Component: Bug },
  { name: "target", Component: Target },
  { name: "trophy", Component: Trophy },
  { name: "cube", Component: Cube },
  { name: "heart", Component: Heart },
  { name: "star", Component: Star },
];

const ICON_MAP: Record<string, React.ComponentType<IconProps>> = {
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

export function ProjectIcon({ icon, color, size }: { icon: string; color: string; size: number }) {
  const Icon = ICON_MAP[icon] || Kanban;
  return <Icon size={size} color={color} weight="duotone" />;
}
