import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import {
  PiBugDuotone,
  PiCameraDuotone,
  PiChatTeardropTextDuotone,
  PiCheckCircleDuotone,
  PiHeartDuotone,
  PiImageDuotone,
  PiLightbulbDuotone,
  PiPencilSimpleBold,
  PiQuestionDuotone,
  PiTrashBold,
  PiXBold,
} from "react-icons/pi";
import type { IconType } from "react-icons";
import MarkupEditor from "./MarkupEditor";
import {
  CAPTURE_IGNORE_ATTRIBUTE,
  FEEDBACK_HISTORY_HREF,
  MAX_WIDGET_ATTACHMENTS,
  OPEN_FEEDBACK_ATTRIBUTE,
  OPEN_FEEDBACK_EVENT,
  buildFeedbackFormData,
  captureVisiblePage,
  collectFeedbackContext,
  imageFilesFrom,
  prepareImageFile,
  readClientErrors,
  takeFeedbackRequest,
  type AttachmentSource,
  type WidgetAttachment,
} from "./feedback-client";

type Kind = "BUG" | "CONFUSING" | "IDEA" | "PRAISE";

export const FEEDBACK_KIND_OPTIONS: {
  value: Kind;
  label: string;
  icon: IconType;
  placeholder: string;
}[] = [
  {
    value: "BUG",
    label: "Something's broken",
    icon: PiBugDuotone,
    placeholder: "What happened, and what did you expect to happen?",
  },
  {
    value: "CONFUSING",
    label: "Confusing",
    icon: PiQuestionDuotone,
    placeholder: "What were you trying to do? Where did you get stuck?",
  },
  {
    value: "IDEA",
    label: "Idea",
    icon: PiLightbulbDuotone,
    placeholder: "What would make this better for you?",
  },
  {
    value: "PRAISE",
    label: "I like this",
    icon: PiHeartDuotone,
    placeholder: "What's working well? Tell us so we keep it.",
  },
];

const DEFAULT_PLACEHOLDER = "What's on your mind?";

/** Excluded from "Capture this page" so the widget never photographs itself. */
const IGNORE_ATTRIBUTE = { [CAPTURE_IGNORE_ATTRIBUTE]: "" };

let nextAttachmentId = 0;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The feedback button and form, available to every signed-in user.
 *
 * Built to cost a student as little as possible: one tap opens it, nothing but
 * a sentence or a screenshot is required, a picture of the current page is one
 * more tap, and they can draw on it to point at the problem. Page address,
 * browser, screen size and recent errors ride along automatically, which is
 * the context a fixer needs and a student would never think to type.
 */
export default function FeedbackWidget({
  showLauncher = true,
}: {
  /** Immersive pages hide the floating button and open the form from their own menu. */
  showLauncher?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<WidgetAttachment[]>([]);
  const [markupId, setMarkupId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"capture" | "send" | null>(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  /*
   * Where focus was when a request made before hydration was replayed. The
   * dialog restores focus from a history it only starts keeping once this
   * module loads, so for a replayed open it has nothing to return to.
   */
  const replayReturnRef = useRef<HTMLElement | null>(null);
  // The launcher is server-rendered; until hydration a click would do nothing.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  useEffect(() => {
    const show = () => {
      takeFeedbackRequest();
      setOpen(true);
    };
    // Lets server-rendered pages offer the form with a plain button.
    const onClick = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(`[${OPEN_FEEDBACK_ATTRIBUTE}]`)
      ) {
        setOpen(true);
      }
    };
    window.addEventListener(OPEN_FEEDBACK_EVENT, show);
    document.addEventListener("click", onClick);
    // A menu may have asked for the form before this island hydrated.
    if (takeFeedbackRequest()) {
      replayReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    }
    return () => {
      window.removeEventListener(OPEN_FEEDBACK_EVENT, show);
      document.removeEventListener("click", onClick);
      for (const attachment of attachmentsRef.current) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (open) setErrorCount(readClientErrors().length);
  }, [open]);

  const roomLeft = MAX_WIDGET_ATTACHMENTS - attachments.length;
  const markupTarget = attachments.find((attachment) => attachment.id === markupId);
  const placeholder =
    FEEDBACK_KIND_OPTIONS.find((option) => option.value === kind)?.placeholder ??
    DEFAULT_PLACEHOLDER;
  const pagePath =
    typeof window === "undefined" ? "" : window.location.pathname;

  function addBlob(blob: Blob, source: AttachmentSource) {
    nextAttachmentId += 1;
    const attachment: WidgetAttachment = {
      id: `attachment-${nextAttachmentId}`,
      blob,
      source,
      previewUrl: URL.createObjectURL(blob),
      marked: false,
    };
    setAttachments((previous) => [...previous, attachment]);
    return attachment;
  }

  async function addFiles(files: File[]) {
    setError("");
    if (files.length === 0) return;
    if (files.length > roomLeft) {
      setError(`You can attach up to ${MAX_WIDGET_ATTACHMENTS} images.`);
    }
    for (const file of files.slice(0, Math.max(roomLeft, 0))) {
      try {
        addBlob(await prepareImageFile(file), "UPLOAD");
      } catch (caught) {
        setError(errorMessage(caught, "That image could not be added."));
      }
    }
  }

  async function capturePage() {
    if (roomLeft <= 0) return;
    setError("");
    setBusy("capture");
    try {
      const blob = await captureVisiblePage();
      const attachment = addBlob(blob, "CAPTURE");
      // Straight into markup: pointing at the problem is the next useful step.
      setMarkupId(attachment.id);
    } catch {
      setError(
        "We couldn't capture this page. Take a screenshot on your device and add it with Add image."
      );
    } finally {
      setBusy(null);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((previous) => {
      const removed = previous.find((attachment) => attachment.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return previous.filter((attachment) => attachment.id !== id);
    });
  }

  function replaceWithMarkup(id: string, blob: Blob) {
    setAttachments((previous) =>
      previous.map((attachment) => {
        if (attachment.id !== id) return attachment;
        URL.revokeObjectURL(attachment.previewUrl);
        return { ...attachment, blob, previewUrl: URL.createObjectURL(blob), marked: true };
      })
    );
    setMarkupId(null);
  }

  function reset() {
    for (const attachment of attachments) URL.revokeObjectURL(attachment.previewUrl);
    setAttachments([]);
    setKind(null);
    setMessage("");
    setError("");
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!message.trim() && attachments.length === 0) {
      setError("Tell us a little about it, or add a screenshot.");
      messageRef.current?.focus();
      return;
    }
    setError("");
    setBusy("send");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        body: buildFeedbackFormData({
          kind,
          message,
          attachments,
          pageUrl: window.location.href,
          pageTitle: document.title,
          context: collectFeedbackContext(),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Something went wrong sending that. Please try again.");
      }
      reset();
      setSent(true);
    } catch (caught) {
      setError(
        errorMessage(caught, "Something went wrong sending that. Please try again.")
      );
    } finally {
      setBusy(null);
    }
  }

  function close() {
    if (busy === "send") return;
    setOpen(false);
    setMarkupId(null);
    setSent(false);
    const target = replayReturnRef.current;
    replayReturnRef.current = null;
    if (target) {
      // After the 200ms leave transition, only if focus fell to the page.
      window.setTimeout(() => {
        const active = document.activeElement;
        if (target.isConnected && (!active || active === document.body)) target.focus();
      }, 300);
    }
  }

  return (
    <>
      {showLauncher && !open && (
        <button
          type="button"
          {...IGNORE_ATTRIBUTE}
          onClick={() => setOpen(true)}
          disabled={!hydrated}
          aria-haspopup="dialog"
          className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-dark/90 p-3 text-sm font-semibold text-ink-primary shadow-lg shadow-black/30 backdrop-blur transition hover:border-primary hover:bg-dark sm:px-4 sm:py-2.5 print:hidden"
        >
          <PiChatTeardropTextDuotone className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Feedback</span>
        </button>
      )}

      <Dialog open={open} onClose={close} className="relative z-50" {...IGNORE_ATTRIBUTE}>
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/50 transition-opacity duration-200 data-[closed]:opacity-0"
        />
        <div className="fixed inset-0 flex items-end justify-center sm:items-end sm:justify-end sm:p-4">
          <DialogPanel
            transition
            data-testid="feedback-panel"
            className="flex max-h-[92dvh] w-full flex-col overflow-y-auto overscroll-contain rounded-t-2xl border border-rule bg-bg-raised p-5 shadow-2xl shadow-black/40 transition duration-200 data-[closed]:translate-y-6 data-[closed]:opacity-0 sm:max-h-[calc(100dvh-2rem)] sm:w-[27rem] sm:rounded-2xl"
            onPaste={(event: React.ClipboardEvent) => {
              const files = imageFilesFrom(event.clipboardData);
              if (files.length > 0) {
                event.preventDefault();
                void addFiles(files);
              }
            }}
            onDragOver={(event: React.DragEvent) => {
              if (event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
                setDragging(true);
              }
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event: React.DragEvent) => {
              event.preventDefault();
              setDragging(false);
              void addFiles(imageFilesFrom(event.dataTransfer));
            }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <DialogTitle className="font-body text-lg font-semibold text-ink-primary">
                {markupTarget ? "Mark up your screenshot" : "Send feedback"}
              </DialogTitle>
              <button
                type="button"
                aria-label="Close feedback"
                onClick={close}
                className="-m-1 rounded-md p-1 text-ink-secondary hover:text-ink-primary"
              >
                <PiXBold className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {sent ? (
              <div className="flex flex-col items-start gap-4" aria-live="polite">
                <PiCheckCircleDuotone className="h-10 w-10 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-base font-semibold text-ink-primary">Thank you, it's with the team.</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
                    You'll see what happens with it, and any reply, on your feedback page.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={FEEDBACK_HISTORY_HREF}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-dark hover:bg-primary/90"
                  >
                    See your feedback
                  </a>
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="rounded-md border border-teal/40 px-4 py-2 text-sm text-ink-secondary hover:bg-teal/20 hover:text-ink-primary"
                  >
                    Send more
                  </button>
                </div>
              </div>
            ) : markupTarget ? (
              <MarkupEditor
                image={markupTarget.blob}
                onCancel={() => setMarkupId(null)}
                onDone={(blob) => replaceWithMarkup(markupTarget.id, blob)}
              />
            ) : (
              <form onSubmit={(event) => void send(event)} className="flex flex-col gap-4" noValidate>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-ink-secondary">
                    What's it about?
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {FEEDBACK_KIND_OPTIONS.map(({ value, label, icon: Icon }) => (
                      <label
                        key={value}
                        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${
                          kind === value
                            ? "border-primary bg-primary/15 text-ink-primary"
                            : "border-rule text-ink-secondary hover:border-primary/50 hover:text-ink-primary"
                        }`}
                      >
                        <input
                          type="radio"
                          name="kind"
                          value={value}
                          checked={kind === value}
                          onChange={() => setKind(value)}
                          onClick={() => kind === value && setKind(null)}
                          className="sr-only"
                        />
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label htmlFor="feedback-message" className="sr-only">
                    Your feedback
                  </label>
                  <textarea
                    id="feedback-message"
                    ref={messageRef}
                    data-autofocus
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={placeholder}
                    rows={4}
                    maxLength={5000}
                    className="w-full resize-y rounded-lg border border-teal/40 bg-dark/60 px-3 py-2.5 text-base text-ink-primary placeholder:text-ink-muted focus:border-primary focus:outline-none sm:text-sm"
                  />
                </div>

                <section aria-labelledby="feedback-screenshots" className="flex flex-col gap-2">
                  <h3 id="feedback-screenshots" className="text-sm font-medium text-ink-secondary">
                    Screenshots <span className="font-normal text-ink-muted">(optional)</span>
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void capturePage()}
                      disabled={busy !== null || roomLeft <= 0}
                      className="inline-flex items-center gap-2 rounded-md border border-teal/40 px-3 py-2 text-sm text-ink-primary transition-colors hover:bg-teal/20 disabled:opacity-40"
                    >
                      <PiCameraDuotone className="h-4 w-4 text-primary" aria-hidden="true" />
                      {busy === "capture" ? "Capturing…" : "Capture this page"}
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy !== null || roomLeft <= 0}
                      className="inline-flex items-center gap-2 rounded-md border border-teal/40 px-3 py-2 text-sm text-ink-primary transition-colors hover:bg-teal/20 disabled:opacity-40"
                    >
                      <PiImageDuotone className="h-4 w-4 text-primary" aria-hidden="true" />
                      Add image
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      data-testid="feedback-file-input"
                      onChange={(event) => {
                        void addFiles(Array.from(event.target.files ?? []));
                        event.target.value = "";
                      }}
                    />
                  </div>
                  <p className={`text-xs ${dragging ? "text-primary" : "text-ink-muted"}`}>
                    {dragging ? "Drop to attach." : "You can also paste or drop images here."}
                  </p>

                  {attachments.length > 0 && (
                    <ul className="grid grid-cols-3 gap-2" aria-label="Attached images">
                      {attachments.map((attachment, index) => (
                        <li
                          key={attachment.id}
                          className="group relative overflow-hidden rounded-md border border-rule bg-dark/60"
                        >
                          <img
                            src={attachment.previewUrl}
                            alt={`Attachment ${index + 1}`}
                            className="aspect-[4/3] w-full object-cover object-top"
                          />
                          {attachment.marked && (
                            <span className="absolute left-1 top-1 rounded bg-dark/80 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              Marked up
                            </span>
                          )}
                          <div className="absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-black/80 to-transparent p-1">
                            <button
                              type="button"
                              onClick={() => setMarkupId(attachment.id)}
                              aria-label={`Draw on attachment ${index + 1}`}
                              className="rounded p-1 text-ink-primary hover:bg-ink-primary/10"
                            >
                              <PiPencilSimpleBold className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeAttachment(attachment.id)}
                              aria-label={`Remove attachment ${index + 1}`}
                              className="rounded p-1 text-ink-primary hover:bg-ink-primary/10"
                            >
                              <PiTrashBold className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <p className="text-xs leading-relaxed text-ink-muted">
                  Sent along with your note: this page ({pagePath}), your browser and screen size
                  {errorCount > 0
                    ? `, and ${errorCount} error message${errorCount === 1 ? "" : "s"} this page logged`
                    : ""}
                  . Only the TTV team sees your note and screenshots. If we plan a fix in public, we never say who asked.
                </p>

                {error && (
                  <p role="alert" className="text-sm text-red-200">
                    {error}
                  </p>
                )}

                <div className="flex items-center justify-between gap-3">
                  <a
                    href={FEEDBACK_HISTORY_HREF}
                    className="text-sm text-ink-muted underline-offset-4 hover:text-ink-primary hover:underline"
                  >
                    Your past feedback
                  </a>
                  <button
                    type="submit"
                    disabled={busy !== null}
                    className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-dark transition-colors hover:bg-primary/90 disabled:opacity-40"
                  >
                    {busy === "send" ? "Sending…" : "Send feedback"}
                  </button>
                </div>
              </form>
            )}
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
