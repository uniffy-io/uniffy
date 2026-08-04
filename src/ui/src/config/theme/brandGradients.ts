/**
 * Identity gradients ride the Unity Violet -> Belonging Pink axis and nothing
 * else (docs/brand/palette.md). Avatars pick a pair off this axis by name hash
 * (components/subject/utils.ts); ordered sets walk it end to end instead, so a
 * grid reads as one sweep rather than a set of unrelated hues.
 */
export const BRAND_AXIS_START = "#694aff";
export const BRAND_AXIS_END = "#fd7eea";

export interface BrandStops {
    start: string;
    end: string;
}

const channels = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
];

const toHex = (rgb: [number, number, number]): string =>
    `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

const mix = (from: string, to: string, t: number): string => {
    const a = channels(from);
    const b = channels(to);
    return toHex([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]);
};

/** Point on the axis, 0 = Unity Violet, 1 = Belonging Pink. */
export const brandAxisColor = (t: number): string =>
    mix(BRAND_AXIS_START, BRAND_AXIS_END, Math.min(1, Math.max(0, t)));

interface RampOptions {
    /** How far along the axis a single item's own gradient travels. */
    span?: number;
    /** Darkening applied to both stops, for white content on top. */
    shade?: number;
}

/**
 * Slice `index` of `total` on the axis, as a gradient of its own so each item
 * carries the same mixed treatment the avatars have.
 */
export function brandRampStops(
    index: number,
    total: number,
    { span = 0.3, shade = 0 }: RampOptions = {},
): BrandStops {
    const position = total > 1 ? index / (total - 1) : 0;
    const start = brandAxisColor(position * (1 - span));
    const end = brandAxisColor(position * (1 - span) + span);
    return {
        start: shade > 0 ? mix(start, "#000000", shade) : start,
        end: shade > 0 ? mix(end, "#000000", shade) : end,
    };
}

export const brandGradient = ({ start, end }: BrandStops, angle = 135): string =>
    `linear-gradient(${angle}deg, ${start}, ${end})`;

// Endpoints, interpolated midpoints (#8e57fa, #b364f4, #d871ef) and a deep
// violet shade. The duo reads well on dark and light and takes white content.
// Kept in sync with the mobile Avatar so a person gets the same backdrop on
// both.
const IDENTITY_PAIRS: readonly BrandStops[] = [
    { start: "#694aff", end: "#fd7eea" },
    { start: "#fd7eea", end: "#694aff" },
    { start: "#694aff", end: "#b364f4" },
    { start: "#b364f4", end: "#fd7eea" },
    { start: "#543bcc", end: "#d871ef" },
    { start: "#8e57fa", end: "#fd7eea" },
    { start: "#694aff", end: "#d871ef" },
    { start: "#8e57fa", end: "#b364f4" },
];

function hashIdentity(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

/**
 * Stops a person is painted with everywhere they appear - avatar backdrop,
 * realtime caret, canvas pointer. Same key in, same pair out, so the surfaces
 * agree on who is who; hash the display name to match the avatars.
 */
export function identityStops(key: string): BrandStops {
    return IDENTITY_PAIRS[hashIdentity(key) % IDENTITY_PAIRS.length];
}

export interface IdentityPaint {
    /** Caret line, pointer arrow, anything that needs one flat value. */
    solid: string;
    /** Avatar backdrop and caret label. */
    gradient: string;
    /** Wash behind selected text. */
    translucent: string;
}

/**
 * Every surface a person shows up on - avatar, realtime caret, canvas pointer.
 * Hash the display name so it matches the avatars. A viewer's accent color
 * deliberately does not feed this: accent themes that viewer's own chrome,
 * while identity paint has to look the same to everyone in the doc.
 */
export function identityPaint(key: string): IdentityPaint {
    const stops = identityStops(key);
    return {
        solid: stops.start,
        gradient: brandGradient(stops),
        translucent: brandAlpha(stops.start, 0.2),
    };
}

/** Hex with an alpha suffix, for washes and tinted chips. */
export const brandAlpha = (hex: string, alpha: number): string =>
    `${hex}${Math.round(Math.min(1, Math.max(0, alpha)) * 255)
        .toString(16)
        .padStart(2, "0")}`;
