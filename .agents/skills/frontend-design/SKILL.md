---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Uniffy Design System

**IMPORTANT: All Uniffy frontend code MUST follow these constraints:**

**Framework and Tools:**
- React 19 + TypeScript
- Tailwind CSS 4 with CSS variable-based theme system
- All imports MUST use `@/` absolute paths (never relative imports)
- All exports MUST use named exports (never `export default`)

**Theme Engine:**
Uniffy uses a dark/light theme with user-customizable accent colors via CSS variables. NEVER hardcode colors.

| Purpose | Tailwind Class |
|---------|---------------|
| Primary accent | `bg-primary` / `text-primary-foreground` |
| Top header, primary sidebar | `bg-nav` |
| App frame (side panels) | `bg-background` / `text-foreground` |
| Content sheet, dialogs, drawers | `bg-surface` |
| Raised block on the sheet | `bg-card` / `text-card-foreground` |
| Subtle/muted | `bg-muted` / `text-muted-foreground`; third text tier `text-subtle-foreground` for timestamps, placeholders, helper copy |
| Form controls | `bg-input border-border`, hover `border-border-strong`, focus `focus-ring` |
| Floating chrome (menus, popovers, pickers) | `popoverShellClass` from `@/components/ui/popover` (`bg-popover shadow-float`) |
| Cards | `Card` from `@/components/ui/card`, or the `shadow-edge` utility on elements that cannot be a div |

Those four background tokens are a ladder, darkest to lightest in dark mode: nav, background, surface, card. A raised block sits exactly one rung above what it sits on.

Floating chrome and cards carry their edge in the shadow layer (`shadow-float`, `shadow-edge`), never a CSS border. Focus has one recipe: the `focus-ring` utility on the element, `focus-ring-within` on a wrapper whose descendant is focused. Never hand-roll `ring-ring`, `focus:ring-*`, or `ring-offset-*`.

Full detail, including the border tiers and the shared control shell, lives in `.agents/rules/frontend.md` ("Theme system").

**Status colors (use specific colors, NOT theme):**
- Success: `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
- Error: `bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
- Warning: `bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400`

**Icon Library:** `@phosphor-icons/react` -- never use other icon sets.

**Component Library:** shadcn/ui primitives in `@/components/ui/` -- always check for existing shared components before creating new ones.

**URN Type Colors:** Each content type has a consistent color from `@/config/theme/urnColors.ts`. Never define URN colors inline.

**Subject Components:** Use `@/components/subject/` for all user/group display (SubjectAvatar, SubjectChip, SubjectPicker, etc.). Never build inline avatar circles or initials helpers.

**Page Requirements:**
- All pages MUST call `useDocumentTitle()` from `@/shared/hooks/useDocumentTitle`
- All domain layouts MUST support Zen Mode (`state.zenMode.isActive`)
- Use the keyboard shortcuts framework from `@/features/settings` for any hotkeys

**Error Handling:** Use the centralized error system (`@/config/errorMessages.ts` + `errorToastMiddleware`). Never write manual `toast.error()` calls.

---

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Must work within Uniffy's theme system (dark/light modes, CSS variable colors). Must use Phosphor icons and shadcn/ui primitives.
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (React + TypeScript + Tailwind CSS 4) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail
- Compatible with Uniffy's dark/light theme modes

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Use the theme system's font stack. For special cases where distinctive typography is needed, choose fonts that are beautiful, unique, and interesting. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Work WITHIN Uniffy's CSS variable theme system. Use the surface ladder (`bg-nav`, `bg-background`, `bg-surface`, `bg-card`) for tone and the accent color system for interactive elements. Commit to a cohesive aesthetic within these constraints.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions. Focus on high-impact moments: one well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth using Tailwind utilities. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between different aesthetics. NEVER converge on common choices across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Commit fully to a distinctive direction and execute it with care.
