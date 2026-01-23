/**
 * Note icon rendering utilities - React components and JSX-based functions.
 *
 * This file contains only functions that return React nodes (JSX).
 * For constants and pure utility functions, import from noteIconConstants.ts.
 */

import * as OutlineIcons from '@heroicons/react/24/outline';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NoteIcon } from './noteIconConstants';

/**
 * Render a note icon (heroicon or emoji) with the given className.
 * Falls back to DocumentTextIcon if no icon or invalid icon.
 */
export function renderNoteIcon(
    icon: NoteIcon | undefined | null,
    className?: string,
): React.ReactNode {
    if (!icon) {
        return <DocumentTextIcon className={className} />;
    }

    if (icon.type === 'emoji') {
        // For emojis, we need to handle sizing differently
        // The className might have h-4 w-4, we extract and apply equivalent font size
        const sizeMatch = className?.match(/h-(\d+)/);
        const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 4;
        const fontSize = size * 4; // Approximate rem to px conversion

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

    // Heroicon
    const IconComponent = (OutlineIcons as Record<string, React.ComponentType<{ className?: string }>>)[icon.value];
    if (IconComponent) {
        return <IconComponent className={className} />;
    }

    // Fallback to default
    return <DocumentTextIcon className={className} />;
}

/**
 * Get a heroicon component by name.
 * Returns undefined if not found.
 */
export function getHeroiconByName(name: string): React.ComponentType<{ className?: string }> | undefined {
    return (OutlineIcons as Record<string, React.ComponentType<{ className?: string }>>)[name];
}

/**
 * Cache for extracted SVG path data from heroicons.
 * Key is icon name, value is array of path `d` attributes.
 */
const svgPathCache = new Map<string, string[]>();

/**
 * Extract SVG path data from a heroicon component.
 * Uses renderToStaticMarkup to convert the React component to HTML,
 * then parses the SVG to extract path `d` attributes.
 * Results are cached for performance.
 */
export function getHeroiconSvgPaths(iconName: string): string[] {
    // Check cache first
    if (svgPathCache.has(iconName)) {
        return svgPathCache.get(iconName)!;
    }

    // Get the icon component
    const IconComponent = (OutlineIcons as Record<string, React.ComponentType<{ className?: string }>>)[iconName];
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
 * Draw a heroicon on a canvas context using its SVG path data.
 * The icon is drawn centered at (x, y) with the specified size.
 *
 * @param ctx - Canvas 2D rendering context
 * @param iconName - Name of the heroicon (e.g., 'StarIcon')
 * @param x - Center X coordinate
 * @param y - Center Y coordinate
 * @param size - Size of the icon (width/height)
 * @param color - Stroke color for the icon
 */
export function drawHeroiconOnCanvas(
    ctx: CanvasRenderingContext2D,
    iconName: string,
    x: number,
    y: number,
    size: number,
    color: string
): boolean {
    const paths = getHeroiconSvgPaths(iconName);
    if (paths.length === 0) {
        return false; // Icon not found, caller should use fallback
    }

    ctx.save();

    // Heroicons use a 24x24 viewBox, scale to desired size
    const scale = size / 24;

    // Translate to center the icon at (x, y)
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(scale, scale);

    // Set stroke style matching heroicons outline style
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
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
