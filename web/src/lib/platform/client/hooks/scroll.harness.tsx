import { useRef, useState } from "react";
import { useScrollAnchoring } from "./scroll";

/**
 * DEV harness only (`/dev/platform-scroll`): a bare message list on the S-2.3
 * hooks, for `e2e/platform-scroll.spec.ts`. Messages have uneven heights, as
 * real ones do. Never imported by production code.
 */
interface Row { id: string; n: number; lines: number }
const row = (n: number): Row => ({ id: `msg-${n}`, n, lines: 1 + (n * 7) % 4 });
const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i));

export default function ScrollHarness() {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(() => span(61, 100));
  const [grown, setGrown] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  // A phone opens a thread in the list's place: the list is hidden, not unmounted.
  const [listHidden, setListHidden] = useState(false);
  const { atBottom, scrollToBottom } = useScrollAnchoring(ref, {
    items: rows, onAnchor: setAnchor, shouldFollow: appended => appended.some(item => item.n < 0),
  });
  const first = rows[0]?.n ?? 1;
  const last = rows.at(-1)?.n ?? 0;
  return (
    <div className="flex flex-col gap-3" data-scroll-harness data-at-bottom={atBottom} data-anchor={anchor ?? ""}>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setRows(current => [...span(Math.max(1, first - 20), first - 1), ...current])} disabled={first <= 1}>Load older</button>
        <button type="button" onClick={() => setRows(current => [...current, row(last + 1)])}>Someone posts</button>
        <button type="button" onClick={() => setRows(current => [...current, { id: `own-${current.length}`, n: -1, lines: 1 }])}>I post</button>
        <button type="button" onClick={() => setGrown(rows.at(-1)?.id ?? null)}>Embed loads</button>
        <button type="button" onClick={scrollToBottom} hidden={atBottom}>Jump to latest</button>
        <button type="button" onClick={() => setListHidden(value => !value)}>{listHidden ? "Back to channel" : "Open thread"}</button>
      </div>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container */}
      <div ref={ref} tabIndex={0} aria-label="Messages" data-scroller className={`h-80 overflow-y-auto rounded border border-rule px-2${listHidden ? " hidden" : ""}`}>
        <ol>
          {rows.map(item => (
            <li key={item.id} data-message-row={item.id} className="border-b border-rule py-2">
              <p>{item.n < 0 ? "My message" : `Message ${item.n}`}</p>
              {Array.from({ length: item.lines }, (_, i) => <p key={i} className="text-ink-secondary">Line {i + 1} of a synthetic message.</p>)}
              {grown === item.id && <div data-embed style={{ height: 240 }}>Embedded work</div>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
