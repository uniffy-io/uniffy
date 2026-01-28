---
applyTo: ./src/ui/**
---

### UI Architecture
The frontend follows a feature-sliced architecture for scalability and maintainability.

**Path Aliases:**
- Use `@/` to refer to the `src/` directory (e.g., `@/components/ui/button`).
- Avoid deep relative imports (e.g., `../../../gen/...`).

**Directory Structure:**
- `src/app/`: App-wide configuration (Redux store, hooks, router).
- `src/features/`: Business logic divided by domain (e.g., `auth`, `notes`, `files`). Each feature folder contains its own `components/`, `hooks/`, and `store/`.
- `src/components/ui/`: Shared, dumb UI primitives (buttons, inputs, etc.) built with Tailwind.
- `src/components/layout/`: Global layout components (Navbar, Sidebar).
- `src/layouts/`: Page wrapper layouts.
- `src/theme/`: Theme engine configuration.
- `src/utils/`: Shared utility functions.

### State Management
- **Redux Toolkit** is used for global state.
- **Typed Hooks**: Always use `useAppDispatch` and `useAppSelector` from `@/app/hooks`.
- **Slices**: Define reducers in `@/features/<feature>/store/`.

### Styling & Theme System

#### Overview
UNIFFY uses a sophisticated theme engine that supports:
- **Dark/Light mode switching**
- **User-customizable accent colors** (persisted per-user in the database)
- **Dynamic text color calculation** for accessibility (auto-adjusts to light/dark text based on accent color brightness)
- **CSS variables** for consistent theming across all components

#### Theme Architecture

**Core Files:**
- `@/theme/types.ts` - Theme interface and predefined themes (default, dark)
- `@/theme/ThemeProvider.tsx` - Main theme provider with CSS variable injection and luminance calculation
- `@/theme/themeSlice.ts` - Redux state for theme name and accent color
- `@/components/ui/accent-color-picker.tsx` - Accent color selection component

**How It Works:**
1. User selects an accent color from the profile page
2. Color is saved to the database via `UpdateMyProfile` API
3. Redux state is updated with the new accent color
4. `ThemeProvider` applies the accent color to CSS variables:
   - `--primary` - The main accent color
   - `--ring` - Focus ring color (matches accent)
   - `--primary-foreground` - Automatically calculated text color (black for light accents, white for dark accents)

#### CSS Variables Reference

**ALWAYS use these Tailwind classes that map to CSS variables:**

**Colors:**
- `bg-primary` / `text-primary` - Main accent color (user-customizable)
- `bg-primary-foreground` / `text-primary-foreground` - Text on accent backgrounds (auto-calculated for contrast)
- `bg-background` / `text-foreground` - Base background and text
- `bg-card` / `text-card-foreground` - Card backgrounds
- `bg-muted` / `text-muted-foreground` - Subtle backgrounds and secondary text
- `bg-accent` / `text-accent-foreground` - Hover states and highlights
- `border-border` - Standard borders
- `border-input` - Input field borders
- `ring-ring` - Focus rings (matches accent color)

**Common Patterns:**
```tsx
// Primary buttons (respects user accent color)
<button className="bg-primary text-primary-foreground hover:bg-primary/90">
  Click Me
</button>

// Page header icons (respects user accent color)
<div className="rounded-xl bg-primary p-3 shadow-lg">
  <IconComponent className="h-7 w-7 text-primary-foreground" />
</div>

// Cards
<div className="rounded-xl border border-border bg-card shadow-sm">
  <div className="px-6 py-4 border-b border-border bg-muted/50">
    <h2 className="text-lg font-semibold text-foreground">Card Title</h2>
  </div>
  <div className="p-6">
    <p className="text-muted-foreground">Card content</p>
  </div>
</div>

// Focus states (automatically uses accent color)
<input className="focus:ring-2 focus:ring-ring focus:border-transparent" />
```

#### CRITICAL RULES

**❌ NEVER DO THIS:**
```tsx
// ❌ Hardcoded colors - won't respect user's accent color
<div className="bg-blue-500 text-white">
<button className="bg-gradient-to-br from-blue-500 to-blue-600">
<div className="text-blue-600 border-blue-500">

// ❌ Direct color values
<div style={{ backgroundColor: '#3b82f6' }}>
```

**✅ ALWAYS DO THIS:**
```tsx
// ✅ Uses CSS variables - respects user's accent color
<div className="bg-primary text-primary-foreground">
<button className="bg-primary text-primary-foreground hover:bg-primary/90">
<div className="text-primary border-primary">

// ✅ Semantic color names
<div className="bg-background text-foreground">
<div className="bg-muted text-muted-foreground">
```

#### Special Color Cases

**Status Colors (DON'T use accent color):**
These should remain consistent regardless of accent color:
```tsx
// ✅ Success - always green
<span className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
  Active
</span>

// ✅ Error - always red
<span className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
  Error
</span>

// ✅ Warning - always yellow
<span className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
  Pending
</span>
```

**Role-based Colors (DON'T use accent color):**
```tsx
// ✅ Admin badges - always purple
<span className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
  Admin
</span>
```

#### Accessing Accent Color in Components

If you need to read the current accent color:
```tsx
import { useAppSelector } from '@/app/hooks';

const accentColor = useAppSelector((state) => state.theme.accentColor);
const currentTheme = useAppSelector((state) => state.theme.currentTheme);
```

To update accent color (typically only in profile settings):
```tsx
import { useAppDispatch } from '@/app/hooks';
import { setAccentColor } from '@/theme/themeSlice';

const dispatch = useAppDispatch();
dispatch(setAccentColor('270 95% 65%')); // HSL format
```

#### Button Component Usage

The `Button` component automatically uses the accent color for the `default` variant:
```tsx
import { Button } from '@/components/ui/button';

// Primary button - uses accent color
<Button variant="default" size="md">
  Save Changes
</Button>

// Other variants
<Button variant="outline" size="md">Outlined</Button>
<Button variant="ghost" size="sm">Ghost</Button>
<Button variant="secondary" size="md">Secondary</Button>
<Button variant="destructive" size="md">Delete</Button>
```

- **Tailwind CSS 4**: Primary styling engine.
- **Usage**: Use Tailwind utility classes that reference CSS variables (see above).
- **Utility**: Use `cn()` helper (from `clsx` + `tailwind-merge`) for conditional class merging in components.

### Component Development
- **Strict Typing**: All components must be fully typed with TypeScript.
- **Imports**: Always use the `@/` alias for non-relative imports. Ensure generated Buf/ConnectRPC files are imported from `@/gen/`.
- **Routing**: Use `react-router-dom` for navigation. Protect private routes using `ProtectedRoute`.

### Modern Design System

**CRITICAL: All new pages, dialogs, and dropdowns MUST follow this standardized design pattern.**

#### Pages & Main Views
Pages should have a consistent modern look with these elements:

1. **Header Section:**
   ```tsx
   <div className="flex items-center justify-between">
     <div className="flex items-center gap-3">
       <div className="rounded-xl bg-primary p-3 shadow-lg">
         <IconComponent className="h-7 w-7 text-primary-foreground" />
       </div>
       <div>
         <h1 className="text-3xl font-bold tracking-tight">Page Title</h1>
         <p className="text-sm text-muted-foreground mt-1">Brief description</p>
       </div>
     </div>
     <Button size="md" onClick={handleAction}>
       <PlusIcon className="h-4 w-4" />
       Action Text
     </Button>
   </div>
   ```

2. **Tables:**
   ```tsx
   <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
     <div className="overflow-x-auto">
       <table className="w-full text-sm">
         <thead>
           <tr className="border-b border-border bg-muted/50">
             <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
               Column Name
             </th>
           </tr>
         </thead>
         <tbody className="divide-y divide-border">
           <tr className="group hover:bg-accent/50 transition-colors cursor-pointer">
             {/* Row content with hover effects */}
           </tr>
         </tbody>
       </table>
     </div>
   </div>
   ```

3. **Loading States:**
   ```tsx
   <div className="flex flex-col items-center gap-2">
     <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div>
     <p className="text-sm text-muted-foreground">Loading...</p>
   </div>
   ```

4. **Empty States:**
   ```tsx
   <div className="flex flex-col items-center gap-2">
     <IconComponent className="h-12 w-12 text-muted-foreground/50" />
     <p className="text-sm font-medium text-foreground">No items found</p>
     <p className="text-xs text-muted-foreground">Additional helpful message</p>
   </div>
   ```

#### Dialogs & Modals
All dialogs MUST follow this structure:

```tsx
import { XMarkIcon, RelevantIcon } from '@heroicons/react/24/outline';
import { cn } from "@/utils/cn";

export function MyDialog({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-background w-full max-w-lg rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <RelevantIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Dialog Title</h2>
              <p className="text-xs text-muted-foreground">Optional subtitle</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-muted transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        
        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Form fields */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold">Field Name *</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="Helpful placeholder"
            />
            <p className="text-xs text-muted-foreground">Helper text if needed</p>
          </div>

          {/* Checkbox groups */}
          <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/20">
            <p className="text-sm font-semibold">Section Title</p>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium group-hover:text-foreground">Option Label</span>
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" size="md" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" size="md" disabled={loading}>
              {loading ? 'Processing...' : 'Submit'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

#### Icons & Visual Elements

**Required Icon Library:**
- Use `@heroicons/react/24/outline` for ALL icons
- Import icons at component level: `import { IconName } from '@heroicons/react/24/outline'`

**Common Icon Patterns:**
- **User avatars:** Circle with initials, can use accent color or role-based colors
  ```tsx
  // With accent color
  <div className="h-10 w-10 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-sm font-semibold text-primary">
    {username.slice(0, 2).toUpperCase()}
  </div>
  
  // Role-based (admin) - use purple, not accent
  <div className="h-10 w-10 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-sm font-semibold text-purple-600 dark:text-purple-400">
    {username.slice(0, 2).toUpperCase()}
  </div>
  ```

- **Status indicators:** Animated dots with labels
  ```tsx
  <div className="flex items-center gap-2">
    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
    <span className="text-xs font-medium text-green-600">Active</span>
  </div>
  ```

- **Badges:** Gradient backgrounds for emphasis
  ```tsx
  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gradient-to-r from-purple-100 to-purple-200 text-purple-700 dark:from-purple-950 dark:to-purple-900 dark:text-purple-300">
    Label
  </span>
  ```

#### Color Usage

**IMPORTANT: Always use CSS variables for theme-related colors!**

- **Primary/Accent actions:** `bg-primary text-primary-foreground` (user-customizable accent color)
- **Buttons:** Use `Button` component with appropriate variant
- **Page headers:** `bg-primary text-primary-foreground`
- **Links and interactive elements:** `text-primary hover:text-primary/80`
- **Focus rings:** `ring-ring` (automatically matches accent color)

**Status colors (use specific colors, not accent):**
- **Success states:** `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
- **Error/destructive:** `bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
- **Warning:** `bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400`

**Role-based colors (use specific colors, not accent):**
- **Admin/elevated roles:** `bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400`

**Neutral elements:**
- **Subtle backgrounds:** `bg-muted/20 text-muted-foreground`
- **Cards:** `bg-card text-card-foreground`
- **Borders:** `border-border`

#### Transitions & Animations
- **Standard transition:** `transition-all duration-300`
- **Hover effects:** `hover:bg-accent/50 hover:scale-[1.02]`
- **Dialog animations:** `animate-in fade-in zoom-in duration-200`
- **Loading spinners:** `animate-spin rounded-full border-4 border-muted border-t-primary`

#### Form Inputs
All form inputs must use this styling:
```tsx
<input
  className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
/>
```

For selects/dropdowns:
```tsx
<select
  className="w-full px-3 py-2 border border-input bg-background rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all capitalize"
>
  <option value="">Choose an option...</option>
</select>
```

#### Spacing Standards
- **Page padding:** `pb-12` at bottom for breathing room
- **Section spacing:** `space-y-8` between major sections
- **Form fields:** `space-y-5` between inputs
- **Dialog padding:** `p-6` for body, `px-6 py-4` for header
- **Table cells:** `px-6 py-4` for consistency

### Best Practices
- **ALWAYS use the theme engine:** Reference CSS variables via Tailwind classes (e.g., `bg-primary`, `text-primary-foreground`), NEVER hardcode colors like `blue-500`
- **Let the Button component handle styling:** Use the appropriate variant instead of custom classes
- **Respect user preferences:** The accent color is user-configurable, so all primary UI elements must use `bg-primary`
- **Use semantic colors for status:** Don't use accent color for success/error/warning states - use green/red/yellow
- **Consistent iconography:** Use Heroicons 24px outline style
- **Responsive design:** Use responsive classes (`md:`, `lg:`) for grids and layouts
- **Accessibility:** Include hover states, focus rings (`ring-ring`), and proper labels
- **Loading states:** Show spinners with `border-t-primary` for consistency
- **Empty states:** Use icons and encouraging messages
- **Error handling:** Display friendly error messages with visual indicators
