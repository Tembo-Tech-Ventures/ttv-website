import { isValidElement, type ReactNode } from "react";

/**
 * Whether a node prop has anything to draw. From an `.astro` page, a named slot
 * inside a condition (`{show && <Fragment slot="action">…</Fragment>}`) still
 * arrives as an element when the condition fails: Astro's static wrapper around
 * an empty string. A part that frames its slot (an action row, a sentence) asks
 * this first, so an empty slot draws no empty box.
 */
export function filled(node: ReactNode): boolean {
  if (node === null || node === undefined || node === false || node === "") return false;
  // Astro's slot value is a SlotString, a String subclass, so `typeof` says "object".
  if (isValidElement<{ value?: unknown }>(node)) {
    const { value } = node.props;
    if (Object.prototype.toString.call(value) === "[object String]") return String(value).trim() !== "";
  }
  return true;
}
