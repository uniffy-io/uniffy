/**
 * Note icon rendering utilities - React components and JSX-based functions.
 *
 * This file contains only functions that return React nodes (JSX).
 * For constants and pure utility functions, import from noteIconConstants.ts.
 */

import { FileText } from '@phosphor-icons/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NoteIcon } from './noteIconConstants';
import { ICON_COMPONENTS } from './noteIconConstants';

/**
 * Render a note icon (phosphor icon or emoji) with the given className.
 * Falls back to FileText if no icon or invalid icon.
 */
export function renderNoteIcon(
    icon: NoteIcon | undefined | null,
    className?: string,
    size?: number,
): React.ReactNode {
    if (!icon) {
        return <FileText className={className} size={size} />;
    }

    if (icon.type === 'emoji') {
        // For emojis, we need to handle sizing differently
        // The className might have h-4 w-4, we extract and apply equivalent font size
        const sizeMatch = className?.match(/h-(\d+)/);
        const extractedSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 4;
        const fontSize = size || extractedSize * 4; // Approximate rem to px conversion

        return (
            <span
                className={className}
                style={{
                    fontSize: `${fontSize}px`,
                    lineHeight: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                {icon.value}
            </span>
        );
    }

    // Phosphor icon
    const IconComponent = ICON_COMPONENTS[icon.value];
    if (IconComponent) {
        return <IconComponent className={className} size={size} />;
    }

    // Fallback to default
    return <FileText className={className} size={size} />;
}

/**
 * Get a Phosphor icon component by name.
 * Returns undefined if not found.
 */
export function getIconByName(name: string) {
    return ICON_COMPONENTS[name];
}

/**
 * Cache for extracted SVG path data from Phosphor icons.
 * Key is icon name, value is array of path `d` attributes.
 */
const svgPathCache = new Map<string, string[]>();

/**
 * Extract SVG path data from a Phosphor icon component.
 * Uses renderToStaticMarkup to convert the React component to HTML,
 * then parses the SVG to extract path `d` attributes.
 * Results are cached for performance.
 */
export function getIconSvgPaths(iconName: string): string[] {
    // Check cache first
    if (svgPathCache.has(iconName)) {
        return svgPathCache.get(iconName)!;
    }

    // Get the icon component
    const IconComponent = ICON_COMPONENTS[iconName];
    if (!IconComponent) {
        return [];
    }

    // Render the icon component to static HTML
    const html = renderToStaticMarkup(<IconComponent />);

    // Parse the HTML to extract SVG path data
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const paths: string[] = [];

    doc.querySelectorAll('path').forEach(path => {
        const d = path.getAttribute('d');
        if (d) {
            paths.push(d);
        }
    });

    // Cache the result
    svgPathCache.set(iconName, paths);

    return paths;
}

/**
 * Draw a Phosphor icon on a canvas context using its SVG path data.
 * The icon is drawn centered at (x, y) with the specified size.
 *
 * @param ctx - Canvas 2D rendering context
 * @param iconName - Name of the Phosphor icon (e.g., 'Star')
 * @param x - Center X coordinate
 * @param y - Center Y coordinate
 * @param size - Size of the icon (width/height)
 * @param color - Stroke color for the icon
 */
export function drawIconOnCanvas(
    ctx: CanvasRenderingContext2D,
    iconName: string,
    x: number,
    y: number,
    size: number,
    color: string
): boolean {
    const paths = getIconSvgPaths(iconName);
    if (paths.length === 0) {
        return false; // Icon not found, caller should use fallback
    }

    ctx.save();

    // Phosphor icons use a 256x256 viewBox, scale to desired size
    const scale = size / 256;

    // Translate to center the icon at (x, y)
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(scale, scale);

    // Set stroke style matching Phosphor regular style
    ctx.strokeStyle = color;
    ctx.lineWidth = 16; // Phosphor uses 16px stroke at 256 viewBox
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw each path
    for (const pathData of paths) {
        const path2D = new Path2D(pathData);
        ctx.stroke(path2D);
    }

    ctx.restore();
    return true;
}
