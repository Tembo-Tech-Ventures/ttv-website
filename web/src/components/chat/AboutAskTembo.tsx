import { PRIVATE_ASK_SEES, type PrivateAskScope } from "@/lib/tembo/private-ask";

/**
 * What the private Ask Tembo page is, said where every question is typed (QA3-03): who can see a
 * conversation, what Tembo reads, how long conversations are kept and where requests go. Only what
 * is true today:
 *
 * - conversations are read only through the asker's own session (`src/lib/chat/sessions.ts`), never
 *   posted in a channel, and no page shows them to anyone else;
 * - they are kept with the account with no time limit, and there is no way to delete one yet;
 * - the model runs on Cloudflare Workers AI through TTV's AI Gateway, which the deploy scripts create
 *   with request logs on, and `/api/chat` does not opt out of them (channel Tembo does);
 * - nothing here counts toward the daily questions in channels.
 *
 * A disclosure rather than a paragraph: the page keeps its one-screen layout (ChatApp).
 */
export default function AboutAskTembo({ scope }: { scope?: PrivateAskScope }) {
  return (
    <details className="group mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 text-xs text-ink-muted sm:px-6" data-about-ask>
      <summary className="cursor-pointer rounded-md py-1 marker:text-ink-muted hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-primary">
        <span className="font-semibold text-ink-secondary">Private</span> · Other members can't see this conversation
        <span className="text-ink-muted"> · What Tembo sees and what's kept</span>
      </summary>
      <ul className="mt-1.5 grid list-disc gap-1 pb-1 pl-5 leading-relaxed">
        {scope && <li>Tembo sees {PRIVATE_ASK_SEES[scope]}. Never channels, other people's messages or their private work.</li>}
        <li>
          Nothing here is posted in a channel, and other members can't see it. In a channel, "Ask Tembo here" posts your
          question and the answer for everyone who can read that channel.
        </li>
        <li>
          Conversations are saved to your account, with no time limit, so you can pick them up again under Recent. You
          can't delete a conversation yet.
        </li>
        <li>
          Tembo is an AI model running on Cloudflare Workers AI, and it can be wrong. Questions and answers go through
          TTV's AI gateway on Cloudflare, which keeps request logs that TTV's technical team can read.
        </li>
        <li>Questions here don't count toward your daily questions to Tembo in channels.</li>
      </ul>
    </details>
  );
}
