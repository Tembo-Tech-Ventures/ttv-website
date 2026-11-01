import type { PersonSummary } from "@/lib/platform/contracts";
import type { Composer, OutboxItem } from "@/lib/platform/client/composer";
import { useOutbox } from "@/lib/platform/client/hooks/composer";
import Avatar from "@/components/platform/ui/Avatar";
import Button from "@/components/platform/ui/Button";
import MessageBody from "./MessageBody";

type OutboxProps = {
  composer: Composer;
  /** The channel (null) or the open thread. */
  parentId: string | null;
  viewer: PersonSummary;
  names: readonly string[];
};

function Status({ item }: { item: OutboxItem }) {
  if (item.status === "sending") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="channel-spinner" aria-hidden="true" /> Sending…
      </span>
    );
  }
  return <span className="font-semibold text-danger-ink">{item.failure?.message ?? "Not sent."}</span>;
}

/**
 * The reader's own messages the server has not confirmed yet, after the
 * conversation: "Sending…", or why a send failed with what can be done about
 * it. Try again reuses the message's nonce, so it is never stored twice;
 * Edit puts the words back in the box; Discard drops them. Failures are
 * announced by the composer, through the view's live region.
 */
export default function Outbox({ composer, parentId, viewer, names }: OutboxProps) {
  const items = useOutbox(composer, parentId);
  if (items.length === 0) return null;
  return (
    <ol className="channel-messages" aria-label="Not sent yet" data-outbox>
      {items.map((item) => (
        <li key={item.clientNonce}>
          <div className="channel-row channel-pending" data-outbox-item={item.status}>
            <article aria-label={`Your message, ${item.status === "sending" ? "sending" : "not sent"}`} className="channel-message">
              <div className="channel-avatar">
                <Avatar id={viewer.id} name={viewer.name} src={viewer.avatarUrl ?? undefined} decorative />
              </div>
              <div className="min-w-0">
                <div className="channel-meta">
                  <span className="channel-author">{viewer.name}</span>
                  <Status item={item} />
                </div>
                <MessageBody body={item.body} names={names} />
                {item.status === "failed" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.failure?.retryable !== false && (
                      <Button size="sm" variant="quiet" onClick={() => void composer.retry(item.clientNonce).catch(() => undefined)}>
                        Try again
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => composer.restore(item.clientNonce)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => composer.discard(item.clientNonce)}>
                      Discard
                    </Button>
                  </div>
                )}
              </div>
            </article>
          </div>
        </li>
      ))}
    </ol>
  );
}
