export type SearchKey = "ArrowDown" | "ArrowUp" | "Home" | "End" | "Escape";

/** -1 means no active descendant. Arrow navigation clamps, never wraps. */
export function searchSelectionReducer(selected: number, key: SearchKey, count: number): number {
  if (key === "Escape" || count <= 0) return -1;
  const current = Math.max(-1, Math.min(selected, count - 1));
  switch (key) {
    case "ArrowDown": return Math.min(current + 1, count - 1);
    case "ArrowUp": return current < 0 ? count - 1 : Math.max(0, current - 1);
    case "Home": return 0;
    case "End": return count - 1;
  }
}
