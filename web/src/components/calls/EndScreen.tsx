import { useEffect, useRef, type ReactNode } from "react";
import { ButtonLink, PageTitle } from "@/components/platform/ui";

/**
 * A page after a call, or instead of one: ended, removed, full, left, joined elsewhere (UX-REVIEW §5:
 * these are pages, and focus moves to their h1). One action at most is the peach one.
 */
export default function EndScreen({ title, children, action, back }: {
  title: string;
  children?: ReactNode;
  /** The one next step, such as "Try again". */
  action?: ReactNode;
  back: { href: string; label: string };
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-call-end>
      <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-10 sm:px-6 sm:py-16">
        <PageTitle ref={heading} tabIndex={-1}>{title}</PageTitle>
        {children && <p className="m-0 max-w-prose text-ink-secondary">{children}</p>}
        <div className="flex flex-wrap gap-3">
          {action}
          <ButtonLink href={back.href} variant={action ? "quiet" : "primary"}>{back.label}</ButtonLink>
        </div>
      </main>
    </div>
  );
}
