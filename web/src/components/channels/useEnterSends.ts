import { useEffect, useState } from "react";

const COARSE = "(pointer: coarse)";

/**
 * Whether Enter sends. Not on touch screens: a soft keyboard has no
 * Shift+Enter, so Enter-to-send would make a second line impossible
 * (docs/chat-full-page-layout.md, rule 7). Keyed on input capability, not
 * device class, and kept live so a tablet that gains a keyboard follows.
 *
 * Starts false on the server and the first render, so hydration agrees; a
 * visible send button is always there.
 */
export function useEnterSends(): boolean {
  const [enterSends, setEnterSends] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(COARSE);
    const update = () => setEnterSends(!query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return enterSends;
}
