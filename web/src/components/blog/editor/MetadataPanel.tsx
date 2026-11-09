/**
 * The floating panel that holds everything about a post that is not the post.
 *
 * Slug, excerpt, counts and the publish controls all live here rather than
 * above or below the writing surface, because the moment they share a column
 * with the prose the page turns back into a form. It floats over the canvas,
 * closes completely, and remembers nothing the author has to re-open it to
 * check — the top bar carries the status on its own.
 */
import React, { useId, useState } from "react";
import { PiArrowSquareOutBold, PiChatTeardropTextBold, PiClockBold, PiTrashBold, PiXBold } from "react-icons/pi";
import {
  Button,
  DescriptionItem,
  DescriptionList,
  HINT,
  IconButton,
  Notice,
  PrefixField,
  TextAreaField,
  linkClass,
} from "@/components/platform/ui";
import { openFeedbackWidget } from "@/components/feedback/feedback-client";
import { MAX_EXCERPT_LENGTH } from "@/lib/blog/post";
import { postPath } from "@/lib/blog/feed";
import type { PostDraft } from "./editor-state";
import { effectiveSlug, wordCount } from "./editor-state";

export type PostStatus = "DRAFT" | "PUBLISHED" | "SUSPENDED";

export interface MetadataPanelProps {
  open: boolean;
  onClose: () => void;
  draft: PostDraft;
  onChange: (patch: Partial<PostDraft>) => void;
  status: PostStatus;
  handle: string | null;
  readingMinutes: number;
  /** The excerpt the server derived, shown when the author has written none. */
  derivedExcerpt: string;
  slugError?: string | null;
  updatedLabel: string | null;
  publishedLabel: string | null;
  /** Rendered into the panel by the editor: publish, unpublish, delete. */
  actions: React.ReactNode;
  canDelete: boolean;
  onDelete: () => void;
}

export default function MetadataPanel({
  open,
  onClose,
  draft,
  onChange,
  status,
  handle,
  readingMinutes,
  derivedExcerpt,
  slugError,
  updatedLabel,
  publishedLabel,
  actions,
  canDelete,
  onDelete,
}: MetadataPanelProps) {
  const slugId = useId();
  const excerptId = useId();

  const slug = effectiveSlug(draft);
  const path = handle && slug ? postPath(handle, slug) : null;
  const words = wordCount(draft.contentMarkdown);

  return (
    <aside
      aria-label="Post settings"
      className={[
        // Off-canvas rather than unmounted: the author's half-typed excerpt
        // survives closing the panel, and the slide reads as the same panel
        // returning rather than a new one appearing.
        "absolute right-3 top-3 bottom-3 z-40 flex w-[min(22rem,calc(100%-1.5rem))] flex-col",
        "rounded-2xl border border-hairline bg-ground/95 shadow-2xl shadow-ground/60 backdrop-blur-xl",
        "transition-[transform,visibility] duration-200 ease-out",
        // `visibility` rather than a conditional render or `aria-hidden`: it
        // takes the closed panel out of the tab order and the accessibility
        // tree, and CSS keeps it visible for the whole slide-out, so it costs
        // nothing to animate. `aria-hidden` alone would leave every control in
        // here reachable by keyboard from behind the canvas.
        open ? "visible translate-x-0" : "invisible translate-x-[calc(100%+1rem)]",
      ].join(" ")}
    >
      <header className="flex items-center justify-between gap-3 border-b border-hairline py-3 pr-3 pl-5">
        <h2 className="m-0 text-lg leading-snug text-ink-primary">Post settings</h2>
        <IconButton label="Close post settings" icon={<PiXBold />} variant="ghost" onClick={onClose} />
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <SlugField
          id={slugId}
          value={draft.slug}
          derived={slug}
          handle={handle}
          status={status}
          error={slugError ?? null}
          onChange={(value) => onChange({ slug: value })}
        />

        <ExcerptField
          id={excerptId}
          value={draft.excerpt}
          derived={derivedExcerpt}
          onChange={(value) => onChange({ excerpt: value })}
        />

        <DescriptionList>
          <DescriptionItem term="Words">{words.toLocaleString("en-US")}</DescriptionItem>
          <DescriptionItem term="Read time">{readingMinutes} min</DescriptionItem>
        </DescriptionList>

        <PublishingSection
          status={status}
          path={path}
          updatedLabel={updatedLabel}
          publishedLabel={publishedLabel}
          actions={actions}
        />

        {canDelete && <DeleteDraft onDelete={onDelete} />}

        {/* On a phone the top bar has no room for it, so it lives here. */}
        <div className="sm:hidden">
          <Button variant="ghost" icon={<PiChatTeardropTextBold />} onClick={openFeedbackWidget}>
            Send feedback
          </Button>
        </div>
      </div>
    </aside>
  );
}

interface SlugFieldProps {
  id: string;
  value: string;
  /** The slug that will actually be used, shown as the placeholder. */
  derived: string;
  handle: string | null;
  status: PostStatus;
  error: string | null;
  onChange: (value: string) => void;
}

function SlugField({
  id,
  value,
  derived,
  handle,
  status,
  error,
  onChange,
}: SlugFieldProps) {
  const hint =
    value.trim() === ""
      ? "Taken from the title. Type here to set your own."
      : status === "PUBLISHED"
        ? "Changing this breaks links people have already shared."
        : "Lowercase letters, numbers and hyphens.";

  return (
    <PrefixField
      id={id}
      label="Address"
      prefix={`/blog/${handle ?? "you"}/`}
      value={value}
      placeholder={derived || "your-post"}
      maxLength={80}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(event) => onChange(event.target.value)}
      hint={error ? undefined : hint}
      error={error ?? undefined}
    />
  );
}

interface ExcerptFieldProps {
  id: string;
  value: string;
  derived: string;
  onChange: (value: string) => void;
}

function ExcerptField({ id, value, derived, onChange }: ExcerptFieldProps) {
  const remaining = MAX_EXCERPT_LENGTH - value.length;

  return (
    <TextAreaField
      id={id}
      label="Excerpt"
      optional
      rows={4}
      maxLength={MAX_EXCERPT_LENGTH}
      value={value}
      // The derived excerpt as the placeholder, so leaving this blank shows
      // what will be published rather than nothing at all.
      placeholder={derived || "A line or two for the blog index."}
      onChange={(event) => onChange(event.target.value)}
      hint={`${value.trim() === "" ? "Left blank, the opening of your post is used." : "Shown on the blog index and in link previews."} ${value.length} of ${MAX_EXCERPT_LENGTH} characters, ${remaining} left.`}
    />
  );
}

interface PublishingSectionProps {
  status: PostStatus;
  path: string | null;
  updatedLabel: string | null;
  publishedLabel: string | null;
  actions: React.ReactNode;
}

function PublishingSection({
  status,
  path,
  updatedLabel,
  publishedLabel,
  actions,
}: PublishingSectionProps) {
  return (
    <section aria-labelledby="post-publishing" className="flex flex-col gap-2 border-t border-hairline pt-5">
      <h3 id="post-publishing" className="m-0 text-base leading-snug text-ink-primary">Publishing</h3>
      {path && status === "PUBLISHED" ? (
        <a href={path} target="_blank" rel="noopener noreferrer" className={linkClass("inline-flex min-w-0 items-center gap-2 self-start text-sm")}>
          <span className="truncate">{path}</span>
          <PiArrowSquareOutBold className="shrink-0" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <p className="m-0 text-sm text-ink-secondary">
          {status === "SUSPENDED" ? "An admin has taken this post down." : "Not published yet: only you can see it."}
        </p>
      )}
      {(updatedLabel || publishedLabel) && (
        <p className={`m-0 flex items-center gap-2 ${HINT}`}>
          <PiClockBold className="shrink-0" aria-hidden />
          {publishedLabel ? `Published ${publishedLabel}` : `Last saved ${updatedLabel}`}
        </p>
      )}
      <div className="pt-1">{actions}</div>
    </section>
  );
}

/**
 * Deleting asks first, inline. A `window.confirm` would be the shorter way to
 * write this and the worse way to read it — it steals focus, cannot be styled,
 * and on a phone lands as an alert from the browser rather than the page.
 */
function DeleteDraft({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="border-t border-hairline pt-5">
      {confirming ? (
        <Notice
          tone="warning"
          title="Delete this draft?"
          actions={
            <>
              <Button variant="danger" size="sm" onClick={onDelete}>Delete draft</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Keep it</Button>
            </>
          }
        >
          It can't be brought back.
        </Notice>
      ) : (
        <Button variant="ghost" icon={<PiTrashBold />} onClick={() => setConfirming(true)}>
          Delete draft
        </Button>
      )}
    </section>
  );
}
