## Searching in UNIFFY

UNIFFY provides a powerful unified search that lets you find any content across your workspace. Open search anytime with `Ctrl+K` (or `Cmd+K` on Mac). You can customize this shortcut in **Settings → Keyboard Shortcuts**.

---

### Basic Search

Just type what you're looking for. UNIFFY uses fuzzy matching, so it will find results even if you have typos or partial words.

```
meeting notes
docker setup
project plan
```

Fuzzy search is great for general discovery—it finds documents containing your search terms anywhere in the title, content, or tags.

---

### Exact Phrase Search

When you need to find an exact phrase, wrap it in double quotes. This is especially useful for:

- **CLI commands and flags**: `"--platform"`, `"npm install"`
- **Error messages**: `"connection refused"`
- **Specific terminology**: `"machine learning"`

**Example:**

| Query | What it finds |
|-------|---------------|
| `docker platform` | Any document with "docker" OR "platform" anywhere |
| `"docker --platform"` | Only documents with the exact phrase "docker --platform" |
| `docker "--platform"` | Documents with "docker" AND the exact flag "--platform" |

When you use quotes, an amber chip appears showing your exact phrase filter. Click the × to remove it.

---

### Type Filters

Narrow your search to specific content types:

| Filter | Description | Example |
|--------|-------------|---------|
| `note:` | Search only notes | `note: meeting` |
| `file:` | Search only files | `file: report.pdf` |
| `user:` | Search users | `user: john` |
| `calendar:` | Search calendar events | `calendar: standup` |
| `chat:` | Search chat messages | `chat: deployment` |
| `book:` | Search library books | `book: design patterns` |
| `password:` | Search vault entries | `password: aws` |
| `space:` | Search spaces | `space: engineering` |

You can combine type filters with other searches:

```
note: "docker --platform" tag:devops
```

---

### Tag Filters

Filter by tags attached to content:

```
tag:work
tag:urgent
tag:"project alpha"
```

Multiple tags use AND logic—all tags must match:

```
tag:work tag:important
```

---

### Ownership Filters

Find your own content or content by a specific user:

| Filter | Description |
|--------|-------------|
| `my:` | Only your content |
| `owner:username` | Content by a specific user |

**Examples:**

```
my: draft
owner:sarah notes
```

---

### Combining Filters

Mix and match filters for precise searches:

```
note: "kubernetes deploy" tag:production my:
```

This finds: Notes you own, tagged "production", containing the exact phrase "kubernetes deploy".

---

### Search Tips

1. **Start broad, then narrow**: Begin with a simple search, then add filters if you get too many results.

2. **Use quotes for technical content**: CLI flags (`--verbose`), error codes, and specific phrases work better with exact matching.

3. **Check the filter chips**: Active filters appear as colored chips below the search box. Remove them by clicking ×.

4. **Keyboard navigation**:
   - `↑/↓` — Navigate results
   - `Enter` — Open selected result
   - `Ctrl+C` / `Cmd+C` — Copy URN of selected result
   - `Esc` — Close search

---

### How It Works

UNIFFY uses [Meilisearch](https://www.meilisearch.com/) for fast, typo-tolerant search with instant results. The search index is updated in real-time as you create and edit content.

**Ranking factors:**
- Title matches rank higher than content matches
- Exact matches rank higher than fuzzy matches
- Recently updated content may appear higher
- Fewer typos = better ranking
