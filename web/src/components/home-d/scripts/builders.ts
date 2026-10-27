/**
 * Shared skills across the builders' card file. Pointing at a card (fine
 * pointers) or focusing it lights every other builder who lists one of its
 * skills: their strip in the index comes out of the shade and names the
 * shared skill, and the shared skills light on both cards' chips and
 * signatures. Works with or without motion; nothing moves.
 */
export function initBuilderKin(root: HTMLElement): () => void {
  const list = root.querySelector<HTMLElement>("#builders .hd-bstack");
  if (!list) return () => {};
  const items = [...list.querySelectorAll<HTMLElement>(":scope > li[data-hd-tags]")];
  const tags = items.map((item) => new Set((item.dataset.hdTags ?? "").split(" ").filter(Boolean)));
  if (items.length < 2) return () => {};
  let active = -1;

  const clear = () => {
    active = -1;
    list.classList.remove("has-kin");
    for (const item of items) {
      item.classList.remove("is-kin", "is-source");
      for (const el of item.querySelectorAll(".is-shared")) el.classList.remove("is-shared");
      const label = item.querySelector<HTMLElement>("[data-hd-shared]");
      if (label) label.textContent = "";
    }
  };

  const light = (index: number) => {
    if (index === active) return;
    clear();
    active = index;
    const mine = tags[index];
    const shared = new Set<string>();
    items.forEach((item, other) => {
      if (other === index) return;
      const common = [...tags[other]].filter((tag) => mine.has(tag));
      if (common.length === 0) return;
      item.classList.add("is-kin");
      const names: string[] = [];
      for (const tag of common) {
        shared.add(tag);
        for (const el of item.querySelectorAll(`[data-tag="${CSS.escape(tag)}"]`)) el.classList.add("is-shared");
        // Its own spelling, from its chips or project language.
        const named = item.querySelector<HTMLElement>(`.hd-bc__skill[data-tag="${CSS.escape(tag)}"], .hd-bc__lang[data-tag="${CSS.escape(tag)}"]`);
        if (named?.textContent) names.push(named.textContent.trim());
      }
      // The strip that stays visible names what is shared, so the index answers "who else knows it".
      const label = item.querySelector<HTMLElement>("[data-hd-shared]");
      if (label) label.textContent = [...new Set(names)].slice(0, 2).join(" · ");
    });
    if (shared.size === 0) return;
    list.classList.add("has-kin");
    items[index].classList.add("is-source");
    for (const tag of shared) {
      for (const el of items[index].querySelectorAll(`[data-tag="${CSS.escape(tag)}"]`)) el.classList.add("is-shared");
    }
  };

  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  const indexOf = (target: EventTarget | null) => items.findIndex((item) => item.contains(target as Node));
  // Cards slide under a resting mouse while the file scrolls: relighting on
  // every pass costs a style and layout pass each time. Wait until the
  // scroll settles, then light whichever card the pointer is on.
  let scrolling = 0;
  const onScroll = () => {
    window.clearTimeout(scrolling);
    scrolling = window.setTimeout(() => {
      scrolling = 0;
      if (!fine.matches) return;
      const hovered = items.findIndex((item) => item.matches(":hover"));
      if (hovered >= 0) light(hovered);
      else if (!list.contains(document.activeElement)) clear();
    }, 180);
  };
  const onOver = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !fine.matches || scrolling) return;
    const index = indexOf(event.target);
    if (index >= 0) light(index);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  const onLeave = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && !list.contains(document.activeElement)) clear();
  };
  const onFocus = (event: FocusEvent) => {
    const index = indexOf(event.target);
    if (index >= 0) light(index);
  };
  const onBlur = (event: FocusEvent) => {
    if (!list.contains(event.relatedTarget as Node | null)) clear();
  };

  list.addEventListener("pointerover", onOver);
  list.addEventListener("pointerleave", onLeave);
  list.addEventListener("focusin", onFocus);
  list.addEventListener("focusout", onBlur);
  return () => {
    clear();
    window.clearTimeout(scrolling);
    window.removeEventListener("scroll", onScroll);
    list.removeEventListener("pointerover", onOver);
    list.removeEventListener("pointerleave", onLeave);
    list.removeEventListener("focusin", onFocus);
    list.removeEventListener("focusout", onBlur);
  };
}
