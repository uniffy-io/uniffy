# Searching in Uniffy

Open search anytime with `Ctrl+K` (or `Cmd+K` on Mac). This shortcut can be customized in **Settings > Keyboard Shortcuts**.

---

### Basic Search

Type what you are looking for. Uniffy uses fuzzy matching, so results appear even with typos or partial words.

```
meeting notes
quarterly report
project plan
```

---

### Exact Phrase Search

Wrap a phrase in double quotes to match it exactly.

| Query | What it finds |
|-------|---------------|
| `budget forecast` | Documents with "budget" OR "forecast" anywhere |
| `"budget forecast"` | Only documents with the exact phrase "budget forecast" |
| `Q3 "budget forecast"` | Documents with "Q3" AND the exact phrase "budget forecast" |

When you use quotes, an amber chip appears showing your exact phrase filter. Click the x to remove it.

---

### Type Filters

Narrow results to a specific content type:

| Filter | Description | Example |
|--------|-------------|---------|
| `note:` | Search only notes | `note: meeting` |
| `file:` | Search only files | `file: report.pdf` |
| `user:` | Search users | `user: john` |
| `calendar:` | Search calendar events | `calendar: standup` |
| `chat:` | Search chat messages | `chat: onboarding` |
| `book:` | Search library books | `book: brand guidelines` |
| `password:` | Search vault entries | `password: company wifi` |
| `space:` | Search spaces | `space: marketing` |

Combine type filters with other searches:

```
note: "quarterly review" tag:finance
```

---

### Tag Filters

Filter by tags attached to content:

```
tag:urgent
tag:"project alpha"
```

Multiple tags use AND logic -- all tags must match:

```
tag:finance tag:Q3
```

---

### Ownership Filters

Find your own content or content by a specific user:

| Filter | Description |
|--------|-------------|
| `my:` | Only your content |
| `owner:username` | Content by a specific user |

Examples:

```
my: draft
owner:sarah proposal
```

---

### Combining Filters

Mix and match for precise results:

```
note: "client proposal" tag:sales my:
```

This finds: notes you own, tagged "sales", containing the exact phrase "client proposal".

---

### Search Tips

1. **Start broad, then narrow** -- Begin with a simple search, then add filters if you get too many results.
2. **Use quotes for specific phrases** -- Names, exact titles, and multi-word terms work better with exact matching.
3. **Check the filter chips** -- Active filters appear as colored chips below the search box. Remove them by clicking x.
4. **Keyboard navigation:**
   - `Up/Down` -- Navigate results
   - `Enter` -- Open selected result
   - `Ctrl+C` / `Cmd+C` -- Copy link to selected result
   - `Esc` -- Close search

---

### How It Works

Search is powered by [Meilisearch](https://www.meilisearch.com/) and updated in real-time as content is created and edited.

**Ranking:**
- Title matches rank higher than content matches
- Exact matches rank higher than fuzzy matches
- Recently updated content may appear higher
