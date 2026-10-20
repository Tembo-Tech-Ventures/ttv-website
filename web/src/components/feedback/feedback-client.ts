/**
 * Browser-side helpers for the feedback widget: what gets captured, how images
 * are prepared, and how a submission is encoded. Kept free of React so the
 * encoding rules can be unit-tested.
 */

export const OPEN_FEEDBACK_EVENT = "ttv:open-feedback";
/** Any element with this attribute opens the widget when clicked. */
export const OPEN_FEEDBACK_ATTRIBUTE = "data-open-feedback";
export const CLIENT_ERROR_BUFFER_KEY = "__ttvClientErrors";
export const FEEDBACK_HISTORY_HREF = "/dashboard/feedback";
export const MAX_WIDGET_ATTACHMENTS = 5;

/** Uploads above this, or wider than MAX_IMAGE_EDGE, are re-encoded first. */
const REENCODE_ABOVE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2560;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type AttachmentSource = "CAPTURE" | "UPLOAD";

export interface WidgetAttachment {
  id: string;
  blob: Blob;
  source: AttachmentSource;
  previewUrl: string;
  /** True once the student has drawn on it. Shown as a small label. */
  marked: boolean;
}

export interface ClientError {
  message: string;
  source?: string;
  at?: string;
}

/** Lets any island (the Ask AI nav, for one) open the widget. */
export function openFeedbackWidget(): void {
  window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT));
}

export function readClientErrors(): ClientError[] {
  const buffer = (window as unknown as Record<string, unknown>)[
    CLIENT_ERROR_BUFFER_KEY
  ];
  return Array.isArray(buffer) ? (buffer as ClientError[]).slice(-10) : [];
}

export function collectFeedbackContext() {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: window.screen.width, height: window.screen.height },
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    colorScheme: prefersDark ? "dark" : "light",
    online: navigator.onLine,
    touch: navigator.maxTouchPoints > 0,
    errors: readClientErrors(),
  };
}

export interface FeedbackDraft {
  kind: string | null;
  message: string;
  attachments: Pick<WidgetAttachment, "blob" | "source">[];
  pageUrl: string;
  pageTitle: string;
  context: unknown;
}

export function buildFeedbackFormData(draft: FeedbackDraft): FormData {
  const formData = new FormData();
  if (draft.kind) formData.set("kind", draft.kind);
  formData.set("message", draft.message);
  formData.set("pageUrl", draft.pageUrl);
  formData.set("pageTitle", draft.pageTitle);
  formData.set("context", JSON.stringify(draft.context));
  draft.attachments.forEach((attachment, index) => {
    const extension = attachment.blob.type.split("/")[1] ?? "png";
    formData.append(
      "attachments",
      attachment.blob,
      `${attachment.source.toLowerCase()}-${index + 1}.${extension}`
    );
    formData.append("attachmentSources", attachment.source);
  });
  return formData;
}

/** Pulls image files out of a paste or drop, ignoring text and other files. */
export function imageFilesFrom(items: DataTransfer | null): File[] {
  if (!items) return [];
  return Array.from(items.files).filter((file) => file.type.startsWith("image/"));
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image."))),
      "image/webp",
      0.9
    );
  });
}

function fitWithin(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Accepts anything the browser can decode. Small PNG/JPEG/WebP/GIF files pass
 * through untouched (an animated GIF stays animated); everything else is
 * redrawn as WebP, which also strips photo metadata such as GPS position.
 */
export async function prepareImageFile(file: Blob): Promise<Blob> {
  const passThrough =
    ACCEPTED_TYPES.has(file.type) &&
    file.type !== "image/jpeg" &&
    file.size <= REENCODE_ABOVE_BYTES;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file is not an image we can read.");
  }
  try {
    if (passThrough && Math.max(bitmap.width, bitmap.height) <= MAX_IMAGE_EDGE) {
      return file;
    }
    const size = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size.width, size.height);
    return await canvasToBlob(canvas);
  } finally {
    bitmap.close();
  }
}

/** Elements carrying this attribute are left out of page captures. */
export const CAPTURE_IGNORE_ATTRIBUTE = "data-feedback-ignore";

const ELEMENT_NODE = 1;

export function includeInCapture(node: Node): boolean {
  if (node.nodeType !== ELEMENT_NODE) return true;
  const element = node as Element;
  return (
    !element.hasAttribute(CAPTURE_IGNORE_ATTRIBUTE) &&
    element.tagName !== "ASTRO-DEV-TOOLBAR"
  );
}

/**
 * Renders what the student can currently see. The page is redrawn from the
 * DOM (no screen-share prompt, works on phones), with the widget itself
 * filtered out of the picture.
 */
export async function captureVisiblePage(): Promise<Blob> {
  const { domToBlob } = await import("modern-screenshot");
  return domToBlob(document.body, {
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
    scale: Math.min(window.devicePixelRatio || 1, 2),
    type: "image/webp",
    quality: 0.9,
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#013D39",
    timeout: 8_000,
    style: {
      // Shift the copy so the visible slice of a scrolled page lands in frame.
      transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
      transformOrigin: "top left",
    },
    filter: includeInCapture,
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
