applyTo: src/ui/**

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
- **Tailwind CSS 4**: Primary styling engine.
- **CSS Variables**: Themes are defined in `@/theme/types.ts` and applied via `@/theme/ThemeProvider.tsx`.
- **Usage**: Use Tailwind utility classes that reference these variables (e.g., `bg-primary`, `text-muted-foreground`).
- **Utility**: Use `cn()` helper (from `clsx` + `tailwind-merge`) for conditional class merging in components.

### Component Development
- **Strict Typing**: All components must be fully typed with TypeScript.
- **Imports**: Always use the `@/` alias for non-relative imports. Ensure generated Buf/ConnectRPC files are imported from `@/gen/`.
- **Routing**: Use `react-router-dom` for navigation. Protect private routes using `ProtectedRoute`.
