import { PiChatTeardropText } from "react-icons/pi";
import { buttonClass } from "@/components/platform/ui";
import { CAPTURE_IGNORE_ATTRIBUTE, OPEN_FEEDBACK_ATTRIBUTE } from "./feedback-client";

/**
 * The floating "Feedback" button, for pages outside the spaces shell. Rendered
 * on the server with no `client:` directive: the feedback loader answers its
 * press, so it works the moment the page shows, and costs no JavaScript until
 * someone uses it. A quiet kit button at its 44px size on an opaque ground, so
 * it reads over whatever scrolls beneath it; its words show from `sm` up, and
 * its name is always "Feedback".
 */
export default function FeedbackLauncher() {
  return (
    <div {...{ [CAPTURE_IGNORE_ATTRIBUTE]: "" }} className="fixed right-4 bottom-4 z-40 rounded-xl bg-ground shadow-overlay print:hidden">
      <button
        type="button"
        {...{ [OPEN_FEEDBACK_ATTRIBUTE]: "" }}
        aria-haspopup="dialog"
        className={buttonClass({ variant: "quiet", size: "lg" })}
      >
        <PiChatTeardropText aria-hidden="true" className="size-5 text-peach-ink" />
        <span className="sr-only sm:not-sr-only">Feedback</span>
      </button>
    </div>
  );
}
