import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type MouseEvent, type SyntheticEvent } from "react";
import type { IconType } from "react-icons";
import {
  PiBug,
  PiCamera,
  PiCheckCircle,
  PiHeart,
  PiImage,
  PiLightbulb,
  PiPencilSimple,
  PiQuestion,
  PiTrash,
  PiX,
} from "react-icons/pi";
import { Button, ButtonLink, Chip, cx, FOCUS_RING, IconButton, Notice, Pill, TextAreaField } from "@/components/platform/ui";
import { HINT } from "@/components/platform/ui/recipes";
import { useModalDialog } from "@/components/platform/overlays/useModalDialog";
import MarkupEditor from "./MarkupEditor";
import {
  FEEDBACK_HISTORY_HREF,
  MAX_WIDGET_ATTACHMENTS,
  buildFeedbackFormData,
  captureVisiblePage,
  collectFeedbackContext,
  imageFilesFrom,
  prepareImageFile,
  readClientErrors,
  type AttachmentSource,
  type WidgetAttachment,
} from "./feedback-client";
import type { OpenFeedback } from "./feedback-loader";

type Kind = "BUG" | "CONFUSING" | "IDEA" | "PRAISE";

export const FEEDBACK_KIND_OPTIONS: {
  value: Kind;
  label: string;
  icon: IconType;
  placeholder: string;
}[] = [
  { value: "BUG", label: "Something's broken", icon: PiBug, placeholder: "What happened, and what did you expect to happen?" },
  { value: "CONFUSING", label: "Confusing", icon: PiQuestion, placeholder: "What were you trying to do? Where did you get stuck?" },
  { value: "IDEA", label: "Idea", icon: PiLightbulb, placeholder: "What would make this better for you?" },
  { value: "PRAISE", label: "I like this", icon: PiHeart, placeholder: "What's working well? Tell us so we keep it." },
];

const DEFAULT_PLACEHOLDER = "What's on your mind?";
const TITLE_ID = "feedback-title";
export const MESSAGE_ID = "feedback-message";
const EMPTY_NOTE = "Tell us a little about it, or add a screenshot.";
const SEND_FAILED = "Something went wrong sending that. Please try again.";

let nextAttachmentId = 0;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The feedback form, available to every signed-in person. It loads only when
 * someone asks for it (feedback-loader.ts), then stays mounted: `onReady`
 * hands back the way to open it again.
 *
 * Built to cost a student as little as possible: nothing but a sentence or a
 * screenshot is required, a picture of the current page is one more tap, and
 * they can draw on it to point at the problem. Page address, browser, screen
 * size and recent errors ride along automatically, which is the context a
 * fixer needs and a student would never think to type.
 *
 * A native modal `<dialog>` (useModalDialog): the page behind goes inert,
 * Escape or the backdrop closes it, unless a note is on its way, and focus
 * goes back to whatever opened it.
 */
export default function FeedbackDialog({ onReady }: { onReady: (open: OpenFeedback) => void }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState("");
  const [attachments, setAttachments] = useState<WidgetAttachment[]>([]);
  const [markupId, setMarkupId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"capture" | "send" | null>(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const dialog = useModalDialog(() => {
    setMarkupId(null);
    setSent(false);
  });

  useEffect(() => {
    onReady((trigger) => {
      dialog.show(trigger);
      setErrorCount(readClientErrors().length);
      // The note is the one thing to do; the dialog would otherwise start on its close button.
      document.getElementById(MESSAGE_ID)?.focus();
    });
    return () => {
      for (const attachment of attachmentsRef.current) URL.revokeObjectURL(attachment.previewUrl);
    };
    // The opener is handed over once; dialog.show is stable.
  }, []); // oxlint-disable-line react-hooks/exhaustive-deps

  const roomLeft = MAX_WIDGET_ATTACHMENTS - attachments.length;
  const markupTarget = attachments.find((attachment) => attachment.id === markupId);
  const placeholder = FEEDBACK_KIND_OPTIONS.find((option) => option.value === kind)?.placeholder ?? DEFAULT_PLACEHOLDER;
  const pagePath = typeof window === "undefined" ? "" : window.location.pathname;

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
    setMessageError("");
    return attachment;
  }

  async function addFiles(files: File[]) {
    setError("");
    if (files.length === 0) return;
    if (files.length > roomLeft) setError(`You can attach up to ${MAX_WIDGET_ATTACHMENTS} images.`);
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
      const attachment = addBlob(await captureVisiblePage(), "CAPTURE");
      // Straight into markup: pointing at the problem is the next useful step.
      setMarkupId(attachment.id);
    } catch {
      setError("We couldn't capture this page. Take a screenshot on your device and add it with Add image.");
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
      }),
    );
    setMarkupId(null);
  }

  function reset() {
    for (const attachment of attachments) URL.revokeObjectURL(attachment.previewUrl);
    setAttachments([]);
    setKind(null);
    setMessage("");
    setError("");
    setMessageError("");
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!message.trim() && attachments.length === 0) {
      setMessageError(EMPTY_NOTE);
      document.getElementById(MESSAGE_ID)?.focus();
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
        throw new Error(body?.error ?? SEND_FAILED);
      }
      reset();
      setSent(true);
    } catch (caught) {
      setError(errorMessage(caught, SEND_FAILED));
    } finally {
      setBusy(null);
    }
  }

  function close() {
    if (busyRef.current !== "send") dialog.hide();
  }

  /* A note on its way stays in view until it lands or fails: neither Escape nor the backdrop closes it. */
  const dialogProps = {
    ...dialog.props,
    onCancel(event: SyntheticEvent<HTMLDialogElement>) {
      if (busyRef.current === "send") event.preventDefault();
    },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      if (busyRef.current !== "send") dialog.props.onClick(event);
    },
  };

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={TITLE_ID}
      className="m-0 mt-auto max-h-none w-full max-w-none overflow-visible bg-transparent p-0 text-ink-primary backdrop:bg-ground/60 sm:mr-4 sm:mb-4 sm:ml-auto sm:w-[27rem] print:hidden"
    >
      <div
        data-testid="feedback-panel"
        className="flex max-h-[92dvh] flex-col gap-4 overflow-y-auto overscroll-contain rounded-t-2xl border border-hairline bg-sheet-community p-5 shadow-overlay sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
        onPaste={(event: ClipboardEvent) => {
          const files = imageFilesFrom(event.clipboardData);
          if (files.length > 0) {
            event.preventDefault();
            void addFiles(files);
          }
        }}
        onDragOver={(event: DragEvent) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          setDragging(false);
          void addFiles(imageFilesFrom(event.dataTransfer));
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={TITLE_ID} className="text-lg leading-snug text-ink-primary">
            {markupTarget ? "Mark up your screenshot" : "Send feedback"}
          </h2>
          <IconButton variant="ghost" label="Close feedback" icon={<PiX className="size-5" />} onClick={close} className="-mt-1 -mr-2" />
        </div>

        {sent ? (
          <div className="flex flex-col items-start gap-4">
            <PiCheckCircle className="size-10 text-success-ink" aria-hidden="true" />
            <div>
              {/* An output is a polite live region: the thanks is read as it replaces the form. */}
              <output className="block text-base font-semibold text-ink-primary">Thank you, it's with the team.</output>
              <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
                You'll see what happens with it, and any reply, on your feedback page.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={FEEDBACK_HISTORY_HREF} variant="primary">
                See your feedback
              </ButtonLink>
              <Button onClick={() => setSent(false)}>Send more</Button>
            </div>
          </div>
        ) : markupTarget ? (
          <MarkupEditor
            image={markupTarget.blob}
            onCancel={() => setMarkupId(null)}
            onDone={(blob) => replaceWithMarkup(markupTarget.id, blob)}
          />
        ) : (
          <form onSubmit={(event) => void send(event)} className="flex flex-col gap-5" noValidate>
            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0 text-sm font-semibold text-ink-primary">
                What's it about? <span className="font-normal text-ink-muted">(optional)</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK_KIND_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <Pill key={value} pressed={kind === value} onClick={() => setKind(kind === value ? null : value)}>
                    <Icon className="size-4" aria-hidden="true" />
                    {label}
                  </Pill>
                ))}
              </div>
            </fieldset>

            <TextAreaField
              id={MESSAGE_ID}
              name="message"
              label="Your feedback"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setMessageError("");
              }}
              placeholder={placeholder}
              rows={4}
              maxLength={5000}
              error={messageError || undefined}
            />

            <section aria-labelledby="feedback-screenshots" className="flex flex-col gap-2">
              <h3 id="feedback-screenshots" className="text-sm font-semibold text-ink-primary">
                Screenshots <span className="font-normal text-ink-muted">(optional)</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  icon={<PiCamera className="size-4" />}
                  onClick={() => void capturePage()}
                  disabled={(busy !== null && busy !== "capture") || roomLeft <= 0}
                  loading={busy === "capture"}
                >
                  Capture this page
                </Button>
                <Button
                  size="sm"
                  icon={<PiImage className="size-4" />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy !== null || roomLeft <= 0}
                >
                  Add image
                </Button>
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
              <p className={dragging ? "text-[0.8125rem] leading-snug font-semibold text-peach-ink" : HINT}>
                {dragging ? "Drop to attach." : "You can also paste or drop images here."}
              </p>

              {attachments.length > 0 && (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Attached images">
                  {attachments.map((attachment, index) => (
                    <li key={attachment.id} className="flex flex-col overflow-hidden rounded-lg border border-hairline bg-ground/40">
                      <span className="relative">
                        <img
                          src={attachment.previewUrl}
                          alt={`Attachment ${index + 1}`}
                          className="aspect-[4/3] w-full object-cover object-top"
                        />
                        {attachment.marked && (
                          // An opaque ground under the chip, so its words read over any screenshot.
                          <span className="absolute top-1 left-1 rounded-full bg-ground">
                            <Chip tone="peach">Marked up</Chip>
                          </span>
                        )}
                      </span>
                      <span className="flex justify-between gap-1 p-1">
                        <IconButton
                          variant="ghost"
                          size="sm"
                          label={`Draw on attachment ${index + 1}`}
                          icon={<PiPencilSimple className="size-4" />}
                          onClick={() => setMarkupId(attachment.id)}
                        />
                        <IconButton
                          variant="ghost"
                          size="sm"
                          label={`Remove attachment ${index + 1}`}
                          icon={<PiTrash className="size-4 text-danger-ink" />}
                          onClick={() => removeAttachment(attachment.id)}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className={HINT}>
              Sent along with your note: this page ({pagePath}), your browser and screen size
              {errorCount > 0 ? `, and ${errorCount} error message${errorCount === 1 ? "" : "s"} this page logged` : ""}. Only the TTV
              team sees your note and screenshots. If we plan a fix in public, we never say who asked.
            </p>

            {error && (
              <Notice tone="danger" title={error}>
                Your note is still here.
              </Notice>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <a
                href={FEEDBACK_HISTORY_HREF}
                className={cx("rounded-sm text-sm text-ink-secondary underline underline-offset-4 hover:text-ink-primary", FOCUS_RING)}
              >
                Your past feedback
              </a>
              <Button type="submit" variant="primary" loading={busy === "send"} disabled={busy === "capture"}>
                Send feedback
              </Button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
