/**
 * The writing surface.
 *
 * The brief was Medium: the post is the page, and everything else earns its
 * place or is not on screen. That means one thin bar at the top, a canvas with
 * nothing in it but the article, formatting that appears over the text when
 * there is text to format, and every setting — slug, excerpt, publishing —
 * behind a panel that floats in from the right and closes again.
 *
 * Two invariants hold the rest together:
 *
 * 1. Markdown is the source of truth. The editor imports it on mount, exports
 *    it on every change, and stores nothing else. `markdown.test.ts` pins that
 *    round trip against the published HTML.
 * 2. Every action is a real form submission carrying the whole draft, so
 *    publishing cannot race the autosave and lose the last sentence written.
 */
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  PiArrowLeftBold,
  PiCloudCheckBold,
  PiMarkdownLogoBold,
  PiNotePencilBold,
  PiSidebarSimpleBold,
  PiSpinnerGapBold,
  PiWarningCircleBold,
} from "react-icons/pi";
import { estimateReadingMinutes } from "@/lib/blog/post";
import { BlockInsertBar, BlockInsertGutter } from "./BlockInsertMenu";
import FloatingToolbar from "./FloatingToolbar";
import MetadataPanel, { type PostStatus } from "./MetadataPanel";
import {
  autosaveReducer,
  canSaveNow,
  initialAutosaveState,
  isDirty,
  isWorthSaving,
  publishBlockers,
  saveStatus,
  saveStatusLabel,
  shouldSave,
  type PostDraft,
  type SaveStatus,
} from "./editor-state";
import { POST_TRANSFORMERS } from "./markdown";
import { POST_EDITOR_NODES } from "./nodes";
import { POST_EDITOR_THEME } from "./theme";

/**
 * How long the author has to stop typing before a save is attempted. Long
 * enough that a sentence is one request rather than thirty, short enough that
 * closing the tab mid-thought does not lose the thought.
 */
const AUTOSAVE_DELAY_MS = 1_200;

export interface PostEditorProps {
  /** `null` until the first autosave brings the post into existence. */
  postId: string | null;
  status: PostStatus;
  initialDraft: PostDraft;
  handle: string | null;
  initialReadingMinutes: number;
  /** What the server derived from the body, shown as the excerpt placeholder. */
  initialDerivedExcerpt: string;
  updatedLabel: string | null;
  publishedLabel: string | null;
  adminNote?: string | null;
  /** Errors from a `<form>` round trip, so both paths report the same way. */
  serverError?: string | null;
  serverSlugError?: string | null;
  /** Renders against fixed data and never calls the API. Used by /dev/writing-ui. */
  mockMode?: boolean;
}

interface SaveResponse {
  id: string;
  slug: string;
  excerpt: string;
  readingMinutes: number;
}

class SaveError extends Error {
  constructor(
    message: string,
    readonly slugError?: string
  ) {
    super(message);
    this.name = "SaveError";
  }
}

export default function PostEditor({
  postId: initialPostId,
  status,
  initialDraft,
  handle,
  initialReadingMinutes,
  initialDerivedExcerpt,
  updatedLabel,
  publishedLabel,
  adminNote = null,
  serverError = null,
  serverSlugError = null,
  mockMode = false,
}: PostEditorProps) {
  const [postId, setPostId] = useState(initialPostId);
  const [state, dispatch] = useReducer(
    autosaveReducer,
    initialDraft,
    initialAutosaveState
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<"rich" | "markdown">("rich");
  const [slugError, setSlugError] = useState<string | null>(serverSlugError);
  const [derivedExcerpt, setDerivedExcerpt] = useState(initialDerivedExcerpt);
  const [savedReadingMinutes, setSavedReadingMinutes] =
    useState(initialReadingMinutes);
  const canvasRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  /** Set while a form submission is on its way, so the unload guard stands down. */
  const leavingRef = useRef(false);

  const draft = state.current;
  const editable = status !== "SUSPENDED";

  const update = useCallback(
    (patch: Partial<PostDraft>) =>
      dispatch({ type: "edit", draft: { ...draft, ...patch } }),
    [draft]
  );

  /**
   * Reading time while typing. Once saved it is replaced by whatever the server
   * computed, so the panel agrees with the post list rather than drifting a
   * minute away from it.
   */
  const readingMinutes = isDirty(state)
    ? estimateReadingMinutes(draft.contentMarkdown)
    : savedReadingMinutes;

  const runSave = useCallback(async () => {
    dispatch({ type: "save-start" });
    if (mockMode) {
      dispatch({ type: "save-ok", at: Date.now() });
      return;
    }
    try {
      const response = await fetch(
        postId ? `/api/blog/posts/${postId}` : "/api/blog/posts",
        {
          method: postId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title,
            slug: draft.slug,
            excerpt: draft.excerpt,
            contentMarkdown: draft.contentMarkdown,
          }),
        }
      );
      const payload = (await response.json().catch(() => null)) as
        | (Partial<SaveResponse> & { error?: string; slugError?: string })
        | null;

      if (!response.ok || !payload?.id) {
        throw new SaveError(
          payload?.slugError ?? payload?.error ?? "Your post could not be saved.",
          payload?.slugError
        );
      }

      // A new post only has an id once the server has made one. Recording it
      // here is what turns every later autosave into an update rather than a
      // second post, and what gives the action forms somewhere to submit to.
      setPostId(payload.id);
      setDerivedExcerpt(payload.excerpt ?? "");
      setSavedReadingMinutes(payload.readingMinutes ?? 1);
      setSlugError(null);
      dispatch({ type: "save-ok", at: Date.now() });
    } catch (error) {
      if (error instanceof SaveError && error.slugError) {
        setSlugError(error.slugError);
        setPanelOpen(true);
      }
      dispatch({
        type: "save-error",
        message:
          error instanceof SaveError
            ? error.message
            : "Your post could not be saved.",
      });
    }
  }, [draft, mockMode, postId]);

  // Autosave. Every edit restarts the timer, so a burst of typing produces one
  // request at the end of it rather than one per keystroke.
  useEffect(() => {
    if (!editable || !shouldSave(state) || !isWorthSaving(draft)) return;
    const timer = setTimeout(runSave, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, editable, runSave, state]);

  useEffect(() => {
    if (!isDirty(state)) return;
    const warn = (event: BeforeUnloadEvent) => {
      // Publishing navigates on purpose and has already put the draft in the
      // form it is submitting; prompting there would be a bug, not a safeguard.
      if (leavingRef.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (editable && canSaveNow(state) && isWorthSaving(draft)) runSave();
      }
      if (event.key === "Escape" && panelOpen) setPanelOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft, editable, panelOpen, runSave, state]);

  /**
   * Runs a status change as a real form submission.
   *
   * Publish is the case that matters. Sending only an id would publish whatever
   * the last autosave happened to catch, so the sentence written just before
   * pressing the button would be missing from the published post. The form
   * carries the whole draft and the server saves before it changes status —
   * which is also exactly what the no-JS `<noscript>` form does.
   */
  const submitAction = (action: string) => {
    const form = formRef.current;
    if (!form) return;
    leavingRef.current = true;
    (form.elements.namedItem("_action") as HTMLInputElement).value = action;
    form.action = postId
      ? `/dashboard/writing/${postId}`
      : "/dashboard/writing/new";
    form.submit();
  };

  const blockers = publishBlockers(draft);
  const canvas =
    mode === "rich" ? (
      <RichCanvas
        // Remounting on a mode switch re-imports Markdown the author may have
        // edited by hand. Without the key the rich editor would come back
        // holding the document it had before the switch.
        key="rich"
        initialMarkdown={draft.contentMarkdown}
        editable={editable}
        canvasRef={canvasRef}
        title={draft.title}
        onTitleChange={(title) => update({ title })}
        onChange={(contentMarkdown) => update({ contentMarkdown })}
      />
    ) : (
      <MarkdownCanvas
        value={draft.contentMarkdown}
        editable={editable}
        title={draft.title}
        onTitleChange={(title) => update({ title })}
        onChange={(contentMarkdown) => update({ contentMarkdown })}
      />
    );

  return (
    <div className="post-editor relative flex min-h-0 flex-1 flex-col">
      <TopBar
        status={status}
        saveLabel={saveStatusLabel(state)}
        saveState={saveStatus(state)}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        mode={mode}
        onToggleMode={() => setMode(mode === "rich" ? "markdown" : "rich")}
        onPublish={() => submitAction("publish")}
        canPublish={editable && blockers.length === 0}
        publishHint={blockers.join(" · ")}
      />

      {(serverError || adminNote) && (
        <p className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-5 py-3 text-sm text-red-200">
          {serverError ?? `Taken down by an admin: ${adminNote}`}
        </p>
      )}

      {/*
        The panel is positioned against this region rather than the whole
        editor, so it opens below the top bar instead of over the very button
        that opened it.

        `overflow-hidden` is load-bearing. The closed panel is parked off the
        right edge, and `visibility: hidden` does not take an element out of
        layout — so without clipping it widened the page by its own width. On a
        phone that is enough for the browser to zoom the whole document out to
        fit, which crushed the editor to a strip and made `100dvh` resolve
        against a viewport twice the real size.
      */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={canvasRef}
          // The only scrolling region on the page. The immersive layout gives
          // the document a fixed height and no scrollbar of its own, so
          // anything that wants to scroll has to say so here.
          className="relative min-h-0 w-full flex-1 overflow-y-auto"
        >
          {canvas}
        </div>

        <MetadataPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        draft={draft}
        onChange={update}
        status={status}
        handle={handle}
        readingMinutes={readingMinutes}
        derivedExcerpt={derivedExcerpt}
        slugError={slugError}
        updatedLabel={updatedLabel}
        publishedLabel={publishedLabel}
        canDelete={status === "DRAFT" && postId !== null}
        onDelete={() => submitAction("delete")}
        actions={
          status === "PUBLISHED" ? (
            <button
              type="button"
              onClick={() => submitAction("unpublish")}
              className="w-full rounded-lg border border-teal px-4 py-2 text-sm font-medium text-ink-primary transition-colors hover:border-primary hover:text-primary"
            >
              Move back to drafts
            </button>
          ) : status === "DRAFT" ? (
            <button
              type="button"
              disabled={blockers.length > 0}
              onClick={() => submitAction("publish")}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-dark transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {blockers.length > 0 ? blockers.join(" · ") : "Publish"}
            </button>
            ) : null
          }
        />
      </div>

      <form ref={formRef} method="POST" hidden>
        <input type="hidden" name="_action" defaultValue="save" />
        <input type="hidden" name="title" value={draft.title} readOnly />
        <input type="hidden" name="slug" value={draft.slug} readOnly />
        <input type="hidden" name="excerpt" value={draft.excerpt} readOnly />
        <input
          type="hidden"
          name="contentMarkdown"
          value={draft.contentMarkdown}
          readOnly
        />
      </form>
    </div>
  );
}

/** The measure the article is written at, shared by both canvases. */
function Column({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[44rem] px-5 pb-40 pt-10 sm:px-8 lg:px-0">
      {children}
    </div>
  );
}

interface TopBarProps {
  status: PostStatus;
  saveLabel: string;
  saveState: SaveStatus;
  panelOpen: boolean;
  onTogglePanel: () => void;
  mode: "rich" | "markdown";
  onToggleMode: () => void;
  onPublish: () => void;
  canPublish: boolean;
  publishHint: string;
}

function TopBar({
  status,
  saveLabel,
  saveState,
  panelOpen,
  onTogglePanel,
  mode,
  onToggleMode,
  onPublish,
  canPublish,
  publishHint,
}: TopBarProps) {
  return (
    <header className="z-30 flex shrink-0 items-center gap-3 border-b border-rule bg-dark/40 px-4 py-2.5 backdrop-blur">
      <a
        href="/dashboard/writing"
        className="flex items-center gap-2 rounded-full px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-white/10 hover:text-ink-primary"
      >
        <PiArrowLeftBold aria-hidden />
        <span className="hidden sm:inline">Writing</span>
      </a>

      <span className="h-5 w-px bg-rule" aria-hidden />

      <StatusPill status={status} />
      <SaveIndicator label={saveLabel} state={saveState} />

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleMode}
          aria-pressed={mode === "markdown"}
          title={
            mode === "rich"
              ? "Edit the raw Markdown"
              : "Back to the formatted editor"
          }
          className={[
            "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
            mode === "markdown"
              ? "bg-primary/20 text-primary"
              : "text-ink-secondary hover:bg-white/10 hover:text-ink-primary",
          ].join(" ")}
        >
          {mode === "rich" ? <PiMarkdownLogoBold /> : <PiNotePencilBold />}
          <span className="sr-only">
            {mode === "rich" ? "Edit Markdown" : "Edit formatted"}
          </span>
        </button>

        {status === "DRAFT" && (
          <button
            type="button"
            onClick={onPublish}
            disabled={!canPublish}
            title={canPublish ? "Publish this post" : publishHint}
            className={[
              "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
              canPublish
                ? "bg-primary text-dark hover:bg-primary/90"
                : // Not a faded primary: at 40% opacity the orange turns to mud
                  // against the teal and reads as a rendering fault rather than
                  // as a button waiting for a title.
                  "cursor-not-allowed border border-rule text-ink-muted",
            ].join(" ")}
          >
            Publish
          </button>
        )}

        <button
          type="button"
          onClick={onTogglePanel}
          aria-expanded={panelOpen}
          aria-label="Post settings"
          className={[
            "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
            panelOpen
              ? "bg-primary/20 text-primary"
              : "text-ink-secondary hover:bg-white/10 hover:text-ink-primary",
          ].join(" ")}
        >
          <PiSidebarSimpleBold />
        </button>
      </div>
    </header>
  );
}

const STATUS_PILL: Record<PostStatus, { label: string; className: string }> = {
  DRAFT: {
    label: "Draft",
    className: "border-teal/60 bg-teal/20 text-ink-secondary",
  },
  PUBLISHED: {
    label: "Live",
    className: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200",
  },
  SUSPENDED: {
    label: "Suspended",
    className: "border-red-400/40 bg-red-400/15 text-red-200",
  },
};

/**
 * Where the post stands, which is a different question from whether the last
 * keystroke reached the server. Keeping them apart is the point: the save
 * indicator used to read "Draft" when it had nothing to say, which on a
 * published post said the opposite of the truth.
 */
function StatusPill({ status }: { status: PostStatus }) {
  const { label, className } = STATUS_PILL[status];
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function SaveIndicator({
  label,
  state,
}: {
  label: string;
  state: SaveStatus;
}) {
  // Nothing has happened yet, and saying so is noise next to the status pill.
  if (state === "idle") return null;

  const Icon =
    state === "saving"
      ? PiSpinnerGapBold
      : state === "error"
        ? PiWarningCircleBold
        : PiCloudCheckBold;

  return (
    <output
      // Announced rather than silent: an author who stops typing to check
      // whether their work is safe should not have to watch a pixel for it.
      // `<output>` carries the status role natively.
      aria-live="polite"
      className={[
        "flex items-center gap-1.5 text-sm",
        state === "error" ? "text-red-300" : "text-ink-muted",
      ].join(" ")}
    >
      <Icon
        className={state === "saving" ? "animate-spin" : undefined}
        aria-hidden
      />
      <span className="hidden sm:inline">{label}</span>
    </output>
  );
}

interface TitleFieldProps {
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
}

function TitleField({ value, editable, onChange }: TitleFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // A textarea rather than an input so a long title wraps instead of scrolling
  // sideways. It will not grow on its own, so it is re-measured on every change.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      maxLength={200}
      readOnly={!editable}
      aria-label="Post title"
      placeholder="Title"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        // Enter belongs to the body. A newline in the title would be dropped on
        // save anyway, so moving the caret on is the honest response.
        if (event.key === "Enter") {
          event.preventDefault();
          document.querySelector<HTMLElement>("[data-post-body]")?.focus();
        }
      }}
      className="mb-7 w-full resize-none overflow-hidden bg-transparent font-heading text-[2.1rem] leading-[1.15] tracking-display text-ink-primary outline-none placeholder:text-ink-muted/45 sm:text-[2.6rem]"
    />
  );
}

interface RichCanvasProps {
  initialMarkdown: string;
  editable: boolean;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  title: string;
  onTitleChange: (value: string) => void;
  onChange: (markdown: string) => void;
}

function RichCanvas({
  initialMarkdown,
  editable,
  canvasRef,
  title,
  onTitleChange,
  onChange,
}: RichCanvasProps) {
  /**
   * Whether the editor is running in a browser yet.
   *
   * Lexical applies `initialConfig.editorState` in an update that only flushes
   * once there is a document, so on the server the editor always looks empty
   * and Lexical renders the placeholder. The client, by the time it hydrates,
   * has the real content and renders no placeholder — a mismatch that made
   * React throw away the entire server-rendered tree and start again. Holding
   * the placeholder back until after mount makes the first client render
   * identical to the server's.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Lazy state rather than `useMemo`: Lexical reads this as the *initial*
  // config, so it must be built exactly once. A memo would be free to recompute
  // — and recomputing it on a keystroke resets the document being typed into.
  // Switching modes remounts this component, which is what re-reads Markdown.
  const [initialConfig] = useState(() => ({
      namespace: "post-editor",
      nodes: POST_EDITOR_NODES,
      theme: POST_EDITOR_THEME,
      editable,
      editorState: () =>
        $convertFromMarkdownString(initialMarkdown, POST_TRANSFORMERS),
      onError: (error: Error) => {
        // Swallowing this would leave the author typing into a broken editor.
        // Throwing hands the canvas to the error boundary instead.
        throw error;
      },
  }));

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <Column>
        <TitleField
          value={title}
          editable={editable}
          onChange={onTitleChange}
        />
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                data-post-body
                aria-label="Post body"
                className="post-body min-h-[45vh] outline-none"
              />
            }
            placeholder={
              !mounted ? null : (
              <div className="pointer-events-none absolute inset-x-0 top-0 select-none">
                <p className="post-body text-ink-muted/55">Tell the story.</p>
                {/* The shortcuts are the fastest way to write in this editor
                    and the only part of it that is invisible, so the empty
                    canvas is where they are worth a line. */}
                <p className="mt-2 text-sm text-ink-muted/40">
                  <span className="font-mono">##</span> makes a heading,{" "}
                  <span className="font-mono">-</span> a list,{" "}
                  <span className="font-mono">&gt;</span> a quote. Select text to
                  format it.
                </p>
              </div>
              )
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
      </Column>

      <HistoryPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <LinkPlugin />
      <HorizontalRulePlugin />
      <TabIndentationPlugin />
      <MarkdownShortcutPlugin transformers={POST_TRANSFORMERS} />
      <OnChangePlugin
        // Without this the Markdown export runs on every arrow key: wasted work
        // and a stream of "edits" that change nothing but re-arm the autosave.
        ignoreSelectionChange
        onChange={(editorState) =>
          editorState.read(() =>
            onChange($convertToMarkdownString(POST_TRANSFORMERS))
          )
        }
      />

      <FloatingToolbar anchorRef={canvasRef} />
      <BlockInsertGutter anchorRef={canvasRef} />
      {/* Sticky rather than fixed: the immersive layout's viewport does not
          scroll, so the bar rides the bottom of the canvas and stays above the
          on-screen keyboard without any measurement of its own. */}
      <div className="sticky bottom-0 z-20">
        <BlockInsertBar />
      </div>
    </LexicalComposer>
  );
}

interface MarkdownCanvasProps {
  value: string;
  editable: boolean;
  title: string;
  onTitleChange: (value: string) => void;
  onChange: (value: string) => void;
}

function MarkdownCanvas({
  value,
  editable,
  title,
  onTitleChange,
  onChange,
}: MarkdownCanvasProps) {
  return (
    <Column>
      <TitleField value={title} editable={editable} onChange={onTitleChange} />
      <textarea
        data-post-body
        aria-label="Post body, as Markdown"
        value={value}
        readOnly={!editable}
        maxLength={40_000}
        spellCheck={false}
        placeholder="Write in Markdown…"
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[60vh] w-full resize-none bg-transparent font-mono text-[0.95rem] leading-relaxed text-ink-primary outline-none placeholder:text-ink-muted/30"
      />
    </Column>
  );
}
