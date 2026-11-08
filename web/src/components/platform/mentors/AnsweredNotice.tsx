import { PiArrowRight } from "react-icons/pi";
import type { MentorRequest } from "@/lib/platform/contracts";
import { ButtonLink, Notice } from "@/components/platform/ui";
import { answeredNotice } from "./mentor-display";

/**
 * Where the queue lands after an answer posted without JavaScript (`?answered=<id>`): what the mentor just
 * did, taking focus so it is read first, with the conversation an acceptance opened. Rendered on the
 * server with no island; nothing when the request reads as nothing the mentor did.
 */
export default function AnsweredNotice({ request }: { request: MentorRequest }) {
  const notice = answeredNotice(request);
  if (!notice) return null;
  const { conversation } = notice;
  return (
    <div className="mb-6" data-request-answered-notice={request.id}>
      <Notice
        tone="success"
        announce="polite"
        focusOnLoad
        title={notice.title}
        actions={conversation && (
          <ButtonLink href={conversation.href} trailingIcon={<PiArrowRight className="size-4" />}>{conversation.label}</ButtonLink>
        )}
      >
        {notice.body}
      </Notice>
    </div>
  );
}
