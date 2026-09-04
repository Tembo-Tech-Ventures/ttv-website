# Blogging

Alumni with a published profile write and publish posts to the TTV blog
themselves. There is no moderation queue: publishing is immediate, and admins
take a post down after the fact by suspending it.

## The data

One table, `blogPost` (`src/lib/db/schema.ts`), owned by a `studentProfile`:

| Column | Why it exists |
|---|---|
| `contentMarkdown` | The source of truth. Everything else is derived from it. |
| `contentHtml`, `renderedWith` | The published HTML, rendered once on save rather than on every request. `renderedWith` is the pipeline version, so a change to rendering can be re-applied to old posts. |
| `excerpt`, `readingMinutes` | Derived on save unless the author wrote an excerpt. |
| `slug` | Unique per author, so two people may both write `/first-post`. |
| `status` | `DRAFT` → `PUBLISHED`, either way round; `SUSPENDED` by an admin, and read-only from then on. |

## The editor

`/dashboard/writing/[id]` — an immersive, chrome-free writing surface built on
[Lexical](https://lexical.dev). Components live in
`src/components/blog/editor/`.

Markdown remains the source of truth. The editor imports it on mount, exports it
on every change, and stores nothing else, which is what keeps the RSS feed, the
public page and the editor from disagreeing about what a post contains.

- **`markdown.ts`** — the transformer set, derived from `POST_SANITIZE_SCHEMA`
  rather than from Lexical's defaults. Lexical's `HIGHLIGHT` (`==text==`) is
  excluded deliberately: it produces a `<mark>`, which the sanitiser drops, so
  an author would see it highlighted while writing and lose it on publish.
- **`FloatingToolbar.tsx`** — formatting appears over a selection, not in a
  permanent strip. Bold, italic, strikethrough, inline code, link, headings,
  quote and lists.
- **`BlockInsertMenu.tsx`** — a `+` in the left gutter of an empty line on a
  wide screen; the same choices as a bar above the keyboard on a phone.
- **`MetadataPanel.tsx`** — slug, excerpt, word count, reading time and the
  publishing controls, floating over the canvas and closed by default.
- Markdown shortcuts work while typing: `## `, `- `, `1. `, `> `, ` ``` `,
  `---`.
- A raw Markdown mode is one button away, for tables, images and anything else
  the rich editor has no transformer for.

### Round-trip safety

`markdown.test.ts` is the guarantee that opening a post and saving it does not
change what readers see. It asserts on the **rendered HTML** rather than the
Markdown string, because the editor legitimately rewrites punctuation — `* item`
comes back as `- item` — and a string comparison would fail on that while
missing the differences that matter.

Constructs the editor has no transformer for (tables, footnotes, raw HTML,
images, reference links) are kept as literal text and written back untouched.
They show as raw Markdown while writing, and render correctly once published.

### Saving

- Autosave, debounced, through `POST /api/blog/posts` and
  `PUT /api/blog/posts/[id]`. Both go through `savePost`, the same function the
  form handler uses, so there is one place where a post is validated.
- Publish, unpublish and delete are real form submissions carrying the whole
  draft. The server saves before it changes status, so publishing cannot go out
  one autosave behind what is on screen.
- With scripting off, `PlainPostForm.astro` renders the same fields as a plain
  form posting the same actions. The `<style>` inside its `<noscript>` is what
  hides the island — the one mechanism that cannot get the two states out of
  step.

## Rendering

`src/lib/blog/render.ts`: remark → GFM → rehype → sanitise → stringify.

- Every heading shifts down one, so the post title keeps the page's only `<h1>`.
  `#` in the editor is `<h2>` on the page.
- External links get `rel="nofollow ugc noopener noreferrer"` and open in a new
  tab; links to `tembotechventures.com` do not.
- The sanitiser allow-list is small and deliberate. No `img`, no raw HTML.

## Reviewing a change to the editor

`/dev/writing-ui` renders the real `PostEditor` with fixed data and no API
calls, which is what `e2e/writing-editor.spec.ts` asserts against and what
`scripts/writing-ui-shots.mjs` screenshots:

```bash
npm run dev
node scripts/writing-ui-shots.mjs /tmp/shots   # needs the dev server running
npx playwright test e2e/writing-editor.spec.ts
```

Screenshot the real component rather than a mock-up. Three of the bugs this
editor shipped without — a hydration mismatch that threw away the server-rendered
tree, an off-canvas panel that made mobile browsers zoom the document out, and a
block menu positioned off the left edge of the window — were invisible in the
code and obvious in a screenshot.
