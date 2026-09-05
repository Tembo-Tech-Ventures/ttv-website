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
import {
  PiArrowSquareOutBold,
  PiClockBold,
  PiGlobeBold,
  PiTrashBold,
  PiWarningCircleBold,
  PiXBold,
} from "react-icons/pi";
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
        "rounded-2xl border border-rule bg-dark/90 shadow-2xl shadow-black/50 backdrop-blur-xl",
        "transition-[transform,visibility] duration-200 ease-out",
        // `visibility` rather than a conditional render or `aria-hidden`: it
        // takes the closed panel out of the tab order and the accessibility
        // tree, and CSS keeps it visible for the whole slide-out, so it costs
        // nothing to animate. `aria-hidden` alone would leave every control in
        // here reachable by keyboard from behind the canvas.
        open ? "visible translate-x-0" : "invisible translate-x-[calc(100%+1rem)]",
      ].join(" ")}
    >
      <header className="flex items-center justify-between border-b border-rule px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
          Post settings
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close post settings"
          className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-white/10 hover:text-ink-primary"
        >
          <PiXBold />
        </button>
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

        <section className="grid grid-cols-2 gap-3">
          <Stat label="Words" value={words.toLocaleString("en-US")} />
          <Stat label="Read time" value={`${readingMinutes} min`} />
        </section>

        <PublishingSection
          status={status}
          path={path}
          updatedLabel={updatedLabel}
          publishedLabel={publishedLabel}
          actions={actions}
        />

        {canDelete && <DeleteDraft onDelete={onDelete} />}
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-rule bg-white/[0.03] px-3 py-2">
      <p className="text-xs uppercase tracking-wider text-ink-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink-primary">
        {value}
      </p>
    </div>
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
    <section className="space-y-2">
      <label
        htmlFor={id}
        className="block text-xs font-semibold uppercase tracking-wider text-ink-muted"
      >
        Address
      </label>
      <div
        className={[
          "flex items-center rounded-lg border bg-dark/60 px-3 py-2 focus-within:border-primary",
          error ? "border-red-500" : "border-teal",
        ].join(" ")}
      >
        <span className="shrink-0 text-sm text-ink-muted">
          /blog/{handle ?? "you"}/
        </span>
        <input
          id={id}
          value={value}
          placeholder={derived || "your-post"}
          maxLength={80}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink-primary outline-none placeholder:text-ink-muted/70"
        />
      </div>
      {error ? (
        <p className="flex items-start gap-1.5 text-sm text-red-400">
          <PiWarningCircleBold className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        <p className="text-xs text-ink-muted">{hint}</p>
      )}
    </section>
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
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={id}
          className="text-xs font-semibold uppercase tracking-wider text-ink-muted"
        >
          Excerpt
        </label>
        <span
          className={[
            "text-xs tabular-nums",
            remaining < 40 ? "text-accent-bright" : "text-ink-muted",
          ].join(" ")}
        >
          {value.length}/{MAX_EXCERPT_LENGTH}
        </span>
      </div>
      <textarea
        id={id}
        rows={4}
        maxLength={MAX_EXCERPT_LENGTH}
        value={value}
        // The derived excerpt as the placeholder, so leaving this blank shows
        // what will be published rather than nothing at all.
        placeholder={derived || "A line or two for the blog index."}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-none rounded-lg border border-teal bg-dark/60 px-3 py-2 text-sm leading-relaxed text-ink-primary outline-none focus:border-primary placeholder:text-ink-muted/70"
      />
      <p className="text-xs text-ink-muted">
        {value.trim() === ""
          ? "Left blank, the opening of your post is used."
          : "Shown on the blog index and in link previews."}
      </p>
    </section>
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
    <section className="space-y-2 border-t border-rule pt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Publishing
      </h3>
      {path && status === "PUBLISHED" ? (
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <PiGlobeBold className="shrink-0" aria-hidden />
          <span className="truncate">{path}</span>
          <PiArrowSquareOutBold className="shrink-0" aria-hidden />
        </a>
      ) : (
        <p className="text-sm text-ink-secondary">
          {status === "SUSPENDED"
            ? "This post has been taken down by an admin."
            : "Not published yet — only you can see this."}
        </p>
      )}
      {(updatedLabel || publishedLabel) && (
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <PiClockBold className="shrink-0" aria-hidden />
          {publishedLabel
            ? `Published ${publishedLabel}`
            : `Last saved ${updatedLabel}`}
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
    <section className="border-t border-rule pt-5">
      {confirming ? (
        <div className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-200">
            Delete this draft? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-400"
            >
              Delete draft
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:text-ink-primary"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-red-400"
        >
          <PiTrashBold aria-hidden />
          Delete draft
        </button>
      )}
    </section>
  );
}
