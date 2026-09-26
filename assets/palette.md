# Uniffy Brand Palette (2026)

Extracted from the 2026 brand book (`Uniffy_BrandBOOK_2026.pdf` in this
directory). Hex values below were verified against the PDF's rendered pixels;
the book's text layer lists Midnight with a copy-paste artifact (`#694aff`) -
the true value was sampled from the artwork.

## Primaries

| Name | Hex | RGB | Notes |
|---|---|---|---|
| Unity Violet | `#694aff` | 105 74 255 | Primary 01 - accent color |
| Momentum Orange | `#ff5500` | 255 85 0 | Primary 02 |
| Growth Green | `#01b77f` | 1 183 127 | Primary 03 |
| Belonging Pink | `#fd7eea` | 253 126 234 | Primary 04 |

## Neutrals

| Name | Hex | Notes |
|---|---|---|
| Midnight | `#0d111e` | Dark base - sampled from artwork (book text layer is wrong) |
| White | `#eeeeee` | Light base |

## Logo symbol segments

The mark's faces use the primaries with one exception: the right face is a
softer orange, not Momentum Orange.

| Face | Hex |
|---|---|
| Left | `#694aff` |
| Top-right | `#fd7eea` |
| Right | `#fb6127` (softer than `#ff5500`) |
| Bottom | `#01b77f` |

Seams between faces are transparent in the extracted assets - they take the
background color, matching how the book renders the mark on colored tiles.

## Contrast (WCAG)

Measured against Midnight `#0d111e` and white:

| Color | On midnight (3:1 UI) | On white (3:1 UI) | White text on it (4.5:1) | Midnight text on it (4.5:1) |
|---|---|---|---|---|
| Violet | 3.61 pass | 5.22 pass | 5.22 pass | 3.61 fail |
| Orange | 5.87 pass | 3.21 pass | 3.21 fail | 5.87 pass |
| Green | 7.24 pass | 2.60 fail | 2.60 fail | 7.24 pass |
| Pink | 8.38 pass | 2.25 fail | 2.25 fail | 8.38 pass |

Implications:

- The palette is dark-mode-first: every primary passes as a UI element on
  Midnight.
- Button/badge text: violet fills take white text; orange, green, and pink
  fills take Midnight text.
- Light mode needs darkened variants of green and pink for icons/text on
  white; violet works as-is (4.69 on `#f1f3f5`).

## Extracted assets (this directory)

| File | Use |
|---|---|
| `uniffy-symbol.png` | Colored mark, transparent bg/seams - universal |
| `uniffy-symbol-on-light.png` | Variant extracted from the white tile |
| `uniffy-logo-horizontal-dark-bg.png` | Symbol + white wordmark, for dark bg |
| `uniffy-logo-vertical-dark-bg.png` | Stacked lockup, for dark bg |

App icon treatments (brand book p.22): colored mark on a white rounded tile,
colored mark on a Midnight tile, and a violet-orange gradient tile with a
white outline mark. Splash concept: violet/green/orange/pink gradient with
white wordmark.
