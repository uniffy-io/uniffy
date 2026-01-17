# Milkdown Plugin Development Guide for UWOS

This guide covers how to create custom Milkdown plugins for the UWOS editor (Crepe).

## Table of Contents

1. [Plugin Architecture](#plugin-architecture)
2. [Plugin Components](#plugin-components)
3. [Integration with Crepe](#integration-with-crepe)
4. [Accessing the Editor View](#accessing-the-editor-view)
5. [React Integration](#react-integration)
6. [Example: Mention Plugin](#example-mention-plugin)
7. [Common Patterns](#common-patterns)
8. [Troubleshooting](#troubleshooting)

---

## Plugin Architecture

Milkdown plugins are built using **composable utilities** that define different aspects of the editor behavior:

- **`$node`** - Define custom node schemas (blocks or inline elements)
- **`$inputRule`** - Trigger behavior on specific text patterns
- **`$view`** - Custom rendering for nodes (React integration)
- **`$command`** - Register callable commands
- **`$prose`** - Direct ProseMirror plugin integration

All composables are imported from `@milkdown/kit/utils`.

---

## Plugin Components

### 1. Node Schema Definition (`$node`)

Define the structure and behavior of custom content nodes.

```typescript
import { $node } from '@milkdown/kit/utils';
import { Node } from '@milkdown/kit/prose/model';

export const mentionNode = $node('mention', () => ({
  group: 'inline',      // 'block' or 'inline'
  inline: true,
  atom: true,           // Treated as single unit
  attrs: {
    id: { default: '' },
    label: { default: '' },
    type: { default: 'note' },
  },
  parseDOM: [
    {
      tag: 'span[data-type="mention"]',
      getAttrs: (dom: HTMLElement) => ({
        id: dom.getAttribute('data-id') || '',
        label: dom.getAttribute('data-label') || '',
        type: dom.getAttribute('data-mention-type') || 'note',
      }),
    },
  ],
  toDOM: (node: Node) => [
    'span',
    {
      'data-type': 'mention',
      'data-id': node.attrs.id,
      'data-label': node.attrs.label,
      'data-mention-type': node.attrs.type,
      class: 'mention-chip',
    },
    `@${node.attrs.label}`,
  ],
  parseMarkdown: {
    match: ({ type }: any) => type === 'mention',
    runner: (state: any, node: any, type: any) => {
      state.addNode(type, {
        id: node.id || '',
        label: node.label || '',
        type: node.type || 'note',
      });
    },
  },
  toMarkdown: {
    match: (node: Node) => node.type.name === 'mention',
    runner: (state: any, node: Node) => {
      state.addNode('text', undefined, `@${(node.attrs as any).label}`);
    },
  },
}));
```

**Key points:**
- `group`: 'block' for paragraphs/headings, 'inline' for text-level elements
- `atom: true`: Prevents cursor from entering the node
- `parseDOM` and `toDOM`: HTML serialization
- `parseMarkdown` and `toMarkdown`: Markdown serialization

### 2. Input Rules (`$inputRule`)

Trigger behavior when user types specific patterns.

```typescript
import { $inputRule } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';

// Store editor view reference (needed for accessing view in input rule)
let editorViewRef: EditorView | null = null;

export const mentionInputRule = $inputRule(() => {
  // Regex: @ followed by alphanumeric characters
  return new InputRule(/@([a-zA-Z0-9-_]*)$/, (state, match, start, end) => {
    const query = match[1] || '';

    // Get view from stored reference
    const view = editorViewRef || (window as any).__milkdownEditorView;

    if (view) {
      // Trigger external UI (search popup, etc.)
      triggerMentionSearch({ query, from: start, to: end, view });
    }

    // Return null to not modify document (let external UI handle insertion)
    return null;
  });
});
```

**Key points:**
- Input rules run on every keystroke
- Regex must match at end of line (`$` anchor)
- Return `null` if you don't want to modify the document
- Return transaction if you want to insert/modify content
- Access to `state`, `match`, `start`, `end` positions

### 3. Custom Node Views (`$view`)

Render custom UI for nodes using React or vanilla JS.

```typescript
import { $view } from '@milkdown/kit/utils';
import { EditorView } from '@milkdown/kit/prose/view';
import type { NodeView } from '@milkdown/kit/prose/view';

class MentionNodeView implements NodeView {
  dom: HTMLElement;
  node: Node;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.node = node;

    // Create the DOM element
    this.dom = document.createElement('span');
    this.dom.className = 'mention-chip';
    this.dom.textContent = `@${node.attrs.label}`;

    // Handle clicks
    this.dom.onclick = (e) => {
      e.preventDefault();
      const { type, id } = node.attrs;
      window.location.hash = `/${type}s/${id}`;
    };
  }

  // Prevent editor from handling events inside the node
  stopEvent() {
    return true;
  }
}

export const mentionView = $view(mentionNode, () =>
  (node: Node, view: EditorView, getPos: () => number | undefined) =>
    new MentionNodeView(node, view, getPos)
);
```

**Key points:**
- Implement `NodeView` interface
- `dom` property is the root element
- `stopEvent()` returns true to handle events internally
- `update()` method handles node updates
- `destroy()` cleans up resources

---

## Integration with Crepe

### Critical: Register Plugins BEFORE `.create()`

Plugins must be registered before calling `.create()`, not after.

```typescript
import { Crepe } from '@milkdown/crepe';
import { mentionPlugins } from './plugins/mention';

const crepe = new Crepe(config);

// ✅ CORRECT: Register before create()
const editor = crepe.editor;
editor.use(mentionPlugins);

// Now create the editor
await crepe.create();

// ❌ WRONG: Don't register after create()
// This won't work!
```

### Full Example in React Component

```typescript
useEffect(() => {
  if (!editorRef.current) return;

  const container = editorRef.current;
  const crepe = new Crepe({
    root: container,
    defaultValue: content,
    features: {
      // ... your features
    },
  });

  // Register custom plugins BEFORE create()
  try {
    const editor = crepe.editor;
    editor.use(mentionPlugins);
  } catch (error) {
    console.error('Failed to register plugins:', error);
  }

  // Setup listeners
  crepe.on((listener) => {
    listener.markdownUpdated((ctx, markdown) => {
      handleContentChange(markdown);
    });
  });

  // Now create
  crepe.create().then(() => {
    crepeRef.current = crepe;
    // Access editor view here if needed
  });

  return () => {
    if (crepeRef.current) {
      crepeRef.current.destroy();
    }
  };
}, []);
```

---

## Accessing the Editor View

The ProseMirror `EditorView` is needed for many operations. Access it after `.create()`:

```typescript
import { editorViewCtx } from '@milkdown/core';

crepe.create().then(() => {
  const editor = crepe.editor;

  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);

    if (view) {
      // Store globally for access in input rules
      (window as any).__milkdownEditorView = view;

      // Or store in module-level variable
      editorViewRef = view;
    }
  });
});
```

**Why you need the view:**
- Get cursor position
- Dispatch transactions
- Access document state
- Position UI elements near cursor

---

## React Integration

### Method 1: React Portal (Recommended for Popups)

For UI that appears outside the editor (like mention search):

```typescript
// In your editor component
const [mentionPopup, setMentionPopup] = useState<MentionTriggerEvent | null>(null);

return (
  <>
    <div ref={editorRef} />

    {/* Render popup via portal */}
    {mentionPopup && createPortal(
      <MentionSearch
        query={mentionPopup.query}
        from={mentionPopup.from}
        to={mentionPopup.to}
        view={mentionPopup.view}
        onSelect={handleSelect}
        onClose={() => setMentionPopup(null)}
      />,
      document.body
    )}
  </>
);
```

### Method 2: Event Bus Pattern

For communication between plugins and React:

```typescript
// In your plugin file
type MentionTriggerEvent = {
  query: string;
  from: number;
  to: number;
  view: EditorView;
};

let mentionEventCallback: ((event: MentionTriggerEvent | null) => void) | null = null;

export function onMentionTrigger(callback: (event: MentionTriggerEvent | null) => void) {
  mentionEventCallback = callback;
}

export function triggerMentionSearch(event: MentionTriggerEvent | null) {
  if (mentionEventCallback) {
    mentionEventCallback(event);
  }
}

// In your input rule
if (view) {
  triggerMentionSearch({ query, from: start, to: end, view });
}

// In your React component
useEffect(() => {
  onMentionTrigger((event) => {
    setMentionPopup(event);
  });

  return () => {
    onMentionTrigger(() => {});
  };
}, []);
```

### Method 3: React in NodeView

For embedding React components inside nodes:

```typescript
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

class ReactNodeView implements NodeView {
  dom: HTMLElement;
  root: Root;

  constructor(node: Node, view: EditorView) {
    this.dom = document.createElement('div');
    this.dom.className = 'my-custom-node';

    // Mount React component
    this.root = createRoot(this.dom);
    this.render();
  }

  render() {
    this.root.render(
      React.createElement(MyComponent, {
        // pass props
      })
    );
  }

  update(node: Node) {
    this.render();
    return true;
  }

  destroy() {
    this.root.unmount();
  }

  stopEvent() {
    return true;
  }
}
```

---

## Example: Mention Plugin

Complete working example of the mention plugin structure:

```
src/ui/src/features/notes/components/editor/plugins/mention/
├── index.ts              # Main plugin exports
├── MentionSearch.tsx     # React search popup component
└── README.md             # Plugin documentation
```

**index.ts:**
```typescript
import { $node, $inputRule, $view } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Node } from '@milkdown/kit/prose/model';
import { EditorView } from '@milkdown/kit/prose/view';
import type { NodeView } from '@milkdown/kit/prose/view';

// 1. Event bus for UI communication
export type MentionTriggerEvent = {
  query: string;
  from: number;
  to: number;
  view: EditorView;
};

let mentionEventCallback: ((event: MentionTriggerEvent | null) => void) | null = null;

export function onMentionTrigger(callback: (event: MentionTriggerEvent | null) => void) {
  mentionEventCallback = callback;
}

function triggerMentionSearch(event: MentionTriggerEvent | null) {
  if (mentionEventCallback) {
    mentionEventCallback(event);
  }
}

// 2. Node schema
export const mentionNode = $node('mention', () => ({
  // ... (see Node Schema section above)
}));

// 3. Input rule
let editorViewRef: EditorView | null = null;

export const mentionInputRule = $inputRule(() => {
  return new InputRule(/@([a-zA-Z0-9-_]*)$/, (state, match, start, end) => {
    const query = match[1] || '';
    const view = editorViewRef || (window as any).__milkdownEditorView;

    if (view) {
      triggerMentionSearch({ query, from: start, to: end, view });
    }

    return null;
  });
});

// 4. Node view
class MentionNodeView implements NodeView {
  // ... (see Custom Node Views section above)
}

export const mentionView = $view(mentionNode, () =>
  (node: Node, view: EditorView, getPos: () => number | undefined) =>
    new MentionNodeView(node, view, getPos)
);

// 5. Export as single array
export const mentionPlugins = [mentionNode, mentionInputRule, mentionView];
```

---

## Common Patterns

### 1. Inserting Content from External UI

When user selects something from a popup and you want to insert it:

```typescript
function handleSelect(item: SearchResultItem) {
  const { view, from, to } = mentionPopup;
  const { state, dispatch } = view;
  const { schema } = state;

  // Get your custom node type
  const mentionType = schema.nodes.mention;
  if (!mentionType) return;

  // Create the node
  const mention = mentionType.create({
    id: item.id,
    label: item.title,
    type: item.type,
  });

  // Replace the trigger text with the node
  const tr = state.tr.replaceWith(from, to, mention);

  // Add a space after
  tr.insertText(' ', from + 1);

  // Set cursor position
  tr.setSelection(
    (state.selection.constructor as any).near(tr.doc.resolve(from + 2))
  );

  dispatch(tr);
  view.focus();
}
```

### 2. Positioning UI Near Cursor

```typescript
function MentionPopup({ from, view }: Props) {
  const coords = view.coordsAtPos(from);

  const style = {
    position: 'fixed' as const,
    left: `${coords.left}px`,
    top: `${coords.bottom + 4}px`,
    zIndex: 1000,
  };

  return <div style={style}>...</div>;
}
```

### 3. Keyboard Navigation in Popups

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelected((prev) => (prev + 1) % items.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelected((prev) => (prev - 1 + items.length) % items.length);
        break;
      case 'Enter':
        e.preventDefault();
        onSelect(items[selected]);
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [items, selected, onSelect, onClose]);
```

---

## Troubleshooting

### Plugin Not Loading

**Problem:** Plugin appears to register but doesn't work.

**Solution:**
- ✅ Ensure you call `editor.use(plugins)` BEFORE `crepe.create()`
- ✅ Check console for errors during plugin registration
- ✅ Verify imports are from `@milkdown/kit/*` not `@milkdown/*`

### Input Rule Not Triggering

**Problem:** Typing pattern doesn't trigger input rule.

**Solution:**
- ✅ Regex must end with `$` to match end of line
- ✅ Input rules only trigger on text input, not programmatic changes
- ✅ Check if another plugin is consuming the input first

### Can't Access Editor View

**Problem:** `editorViewCtx` returns undefined.

**Solution:**
- ✅ Only access view AFTER `.create()` completes
- ✅ Use `editor.action((ctx) => { const view = ctx.get(editorViewCtx); })`
- ✅ Store reference globally or in module variable for input rules

### React Component Not Rendering

**Problem:** NodeView React component doesn't show.

**Solution:**
- ✅ Use `createRoot` from `react-dom/client`, not legacy `render`
- ✅ Call `root.unmount()` in `destroy()` method
- ✅ Check if `stopEvent()` returns `true`

### Infinite Re-renders

**Problem:** Component re-renders constantly.

**Solution:**
- ✅ Don't create arrays/objects in component body (move outside or use `useMemo`)
- ✅ Avoid calling `setState` directly in render
- ✅ Check useEffect dependencies

---

## Best Practices

1. **Keep plugins simple** - One plugin = one feature
2. **Export as array** - `export const myPlugins = [node, rule, view]`
3. **Use TypeScript** - Leverage Milkdown's type system
4. **Test thoroughly** - Edge cases like empty content, cursor at start/end
5. **Document your plugins** - Future you will thank you
6. **Follow naming conventions** - `[feature]Node`, `[feature]InputRule`, `[feature]View`
7. **Clean up resources** - Always implement `destroy()` methods
8. **Use theme variables** - Don't hardcode colors, use CSS variables

---

## Additional Resources

- [Official Milkdown Docs](https://milkdown.dev/)
- [ProseMirror Guide](https://prosemirror.net/docs/guide/)
- [Remark](https://github.com/remarkjs/remark) (for markdown processing)
- [UWOS Codebase Docs](./README.md)

---

## Summary

**Plugin Creation Checklist:**

- [ ] Create plugin directory in `src/ui/src/features/notes/components/editor/plugins/[name]/`
- [ ] Define node schema with `$node`
- [ ] Add input rule with `$inputRule` (if needed)
- [ ] Create custom view with `$view` (if needed)
- [ ] Export all as `[name]Plugins` array
- [ ] Register in `CrepeEditor.tsx` BEFORE `.create()`
- [ ] Add CSS styles in `notes-editor.css`
- [ ] Test in both light and dark modes
- [ ] Document usage in plugin README

**Remember:** Plugins are registered before `.create()`, view is accessed after `.create()`.
