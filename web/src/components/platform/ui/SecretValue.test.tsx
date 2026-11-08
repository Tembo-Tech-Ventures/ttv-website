import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SecretValue } from "@/components/platform/ui";

describe("SecretValue", () => {
  const html = renderToStaticMarkup(
    <SecretValue id="new-key" title="Your new key: Nightly check" value="ttv_pat_0123456789abcdef" copyLabel="Copy key" usage="Send it as a header.">
      Copy it now: it won't be shown again.
    </SecretValue>,
  );

  it("is a card region named by its h2, saying what to do before the value", () => {
    expect(html).toMatch(/^<section aria-labelledby="new-key-title" data-card="true"/);
    expect(html).toMatch(/<h2 id="new-key-title" class="text-lg text-ink-primary">Your new key: Nightly check<\/h2>[\s\S]*?Copy it now/);
  });

  it("shows the value in mono, wrapping anywhere, beside a quiet button that names what it copies and where it is", () => {
    expect(html).toMatch(/<code id="new-key" class="[^"]*font-mono[^"]*break-all[^"]*">ttv_pat_0123456789abcdef<\/code>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Copy key<\/button>/);
    expect(html).toContain('data-copy-secret="new-key"');
    expect(html).toContain('data-variant="quiet"');
    expect(html).not.toContain('data-variant="primary"');
    expect(html).toContain("Send it as a header.");
  });

  it("leaves the usage line out when there is none", () => {
    const bare = renderToStaticMarkup(<SecretValue id="k" title="Key" value="v" copyLabel="Copy key">Now.</SecretValue>);
    expect(bare.match(/<p\b/g)).toBeNull();
  });
});
