Summary
The UWOS Notes page should feel like the best of Notion (block-based flexibility), Obsidian (wiki-linking and graph), and Google Docs (real-time collaboration) — unified into a single, cohesive experience that integrates deeply with all other UWOS modules.
Milkdown's Crepe editor gives us 70% of what we need out of the box. The remaining 30% — wiki-links, universal references, backlinks, graph view, and UWOS integrations — will be built as custom plugins that leverage Milkdown's excellent extensibility.

We should redesign and refactor the notes pages in the UI that we have now. 

Look at the picture of how the design idea should be. On top of that we should have a different modes for the editor that are switchable: 

- The Editor
- A full markdown editor with split view for preview ( if toggled )
- Read Only Mode

We are using milkdown, so use context7 or deepwiki to fetch what you need first to implement this. 

RIght now we care only for the UI. We will implement the backend later. 

Part 1: Understanding Milkdown's Architecture
What Milkdown Gives Us Out of the Box
Crepe Editor Features (toggleable):

CodeMirror — Syntax-highlighted code blocks with language detection
BlockEdit — Drag handles + slash command menu for block manipulation
Toolbar — Floating formatting toolbar on text selection
LinkTooltip — Preview/edit links inline
Placeholder — Empty state placeholder text
ListItem — Enhanced list handling
ImageBlock — Image upload and display
Table — Full table support with cell controls
Latex — Mathematical equation rendering
Cursor — Drop cursor and gap cursor for precise editing
GFM — GitHub Flavored Markdown extensions

Core Technical Capabilities:

Built on ProseMirror (battle-tested rich text engine)
Markdown ↔ ProseMirror bidirectional transformation via remark
Y.js integration for real-time collaborative editing
Headless design — complete styling freedom
Vue 3 components for UI elements (tooltips, menus, handles)
Floating UI for positioning (replaced Tippy.js in v7.4)

What We Must Build Custom

Wiki-links [[note-name]] — Custom node + autocomplete
Universal References @ — Custom mention system for notes/files/people/messages
Backlinks Panel — Query and display incoming links
Graph View — Visual node graph of connections
UWOS Integration Layer — File embeds, chat message refs, calendar links
Custom Slash Menu Items — UWOS-specific block types

Start on what we can build with the library first. We will later on continue with the customs