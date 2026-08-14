import { FileText } from "@phosphor-icons/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { IconValue } from "@/components/icon-picker/iconConstants";
import { ICON_COMPONENTS } from "@/components/icon-picker/iconConstants";

export function renderIcon(
  icon: IconValue | undefined | null,
  className?: string,
  size?: number,
): React.ReactNode {
  if (!icon) {
    return <FileText className={className} size={size} />;
  }

  if (icon.type === "emoji") {
    const sizeMatch = className?.match(/h-(\d+)/);
    const extractedSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 4;
    const fontSize = size || extractedSize * 4;

    return (
      <span
        className={className}
        style={{
          fontSize: `${fontSize}px`,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon.value}
      </span>
    );
  }

  const IconComponent = ICON_COMPONENTS[icon.value];
  if (IconComponent) {
    return <IconComponent className={className} size={size} />;
  }

  return <FileText className={className} size={size} />;
}

export function getIconByName(name: string) {
  return ICON_COMPONENTS[name];
}

const svgPathCache = new Map<string, string[]>();

/** Renders the icon to HTML and parses path `d` attributes; Phosphor's runtime API doesn't expose the raw paths. */
export function getIconSvgPaths(iconName: string): string[] {
  if (svgPathCache.has(iconName)) {
    return svgPathCache.get(iconName)!;
  }

  const IconComponent = ICON_COMPONENTS[iconName];
  if (!IconComponent) {
    return [];
  }

  const html = renderToStaticMarkup(<IconComponent />);
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const paths: string[] = [];

  doc.querySelectorAll("path").forEach((path) => {
    const d = path.getAttribute("d");
    if (d) {
      paths.push(d);
    }
  });

  svgPathCache.set(iconName, paths);
  return paths;
}

export function drawIconOnCanvas(
  ctx: CanvasRenderingContext2D,
  iconName: string,
  x: number,
  y: number,
  size: number,
  color: string,
): boolean {
  const paths = getIconSvgPaths(iconName);
  if (paths.length === 0) {
    return false;
  }

  ctx.save();

  // Phosphor icons use a 256x256 viewBox.
  const scale = size / 256;
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(scale, scale);

  ctx.strokeStyle = color;
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const pathData of paths) {
    const path2D = new Path2D(pathData);
    ctx.stroke(path2D);
  }

  ctx.restore();
  return true;
}
