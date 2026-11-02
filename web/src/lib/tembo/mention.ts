/**
 * "@tembo" as its own word, in any case: not part of an address (name@tembo.org), a longer handle
 * (@tembotech) or a link (@tembo.co). A mention in a post asks Tembo, exactly as the Ask button does.
 */
const TEMBO_MENTION = /(?<![\p{L}\p{N}_.@-])@tembo(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}])/iu;

export function mentionsTembo(body: string): boolean {
  return TEMBO_MENTION.test(body.normalize("NFKC"));
}
