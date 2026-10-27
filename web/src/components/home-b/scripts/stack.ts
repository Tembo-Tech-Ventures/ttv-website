import { clamp01, navHeight, type Scene } from "./scenes";

/**
 * How much of the next sheet is already on screen when a sheet stops moving,
 * as a fraction of the viewport. The next sheet's edge and title are rising
 * while this one settles back, so the stack costs no extra scroll at all.
 */
export const LEAD = 0.36;

/**
 * The page-level stack. Each sheet but the last sticks once its bottom edge is
 * LEAD above the bottom of the screen (or under the nav when it is shorter),
 * then tips back, shrinks and dims while the next sheet slides over it.
 */
export function sheetScene(root: HTMLElement): Scene {
  const sheets = [...root.querySelectorAll<HTMLElement>("[data-hb-sheet]")];
  const dims = sheets.map((sheet) => sheet.querySelector<HTMLElement>(":scope > [data-hb-dim]"));
  const progress = sheets.map(() => 0);
  let vh = window.innerHeight;
  let nav = 0;
  let lead = 0;

  return {
    measure() {
      vh = window.innerHeight;
      nav = navHeight();
      lead = Math.round(vh * LEAD);
      root.classList.add("hb-stacked");
      sheets.forEach((sheet, index) => {
        if (index === sheets.length - 1) return;
        const stick = Math.min(nav, vh - lead - sheet.offsetHeight);
        sheet.style.setProperty("--hb-stick", `${stick}px`);
        // Tip back around the middle of whatever part of the sheet is on screen.
        sheet.style.setProperty("--hb-origin", `${Math.round((vh - lead) / 2 - stick)}px`);
      });
    },
    read() {
      for (let index = 0; index < sheets.length - 1; index += 1) {
        const top = sheets[index + 1].getBoundingClientRect().top;
        progress[index] = clamp01((vh - lead - top) / (vh - lead - nav));
      }
    },
    write() {
      for (let index = 0; index < sheets.length - 1; index += 1) {
        const p = progress[index];
        const eased = p * (2 - p);
        const sheet = sheets[index];
        sheet.style.transform =
          p > 0 ? `perspective(1400px) rotateX(${(7 * eased).toFixed(2)}deg) scale(${(1 - 0.08 * eased).toFixed(4)})` : "";
        sheet.style.willChange = p > 0 && p < 1 ? "transform" : "";
        const dim = dims[index];
        if (dim) dim.style.opacity = (0.62 * p).toFixed(3);
      }
    },
    destroy() {
      root.classList.remove("hb-stacked");
      sheets.forEach((sheet, index) => {
        sheet.style.removeProperty("--hb-stick");
        sheet.style.removeProperty("--hb-origin");
        sheet.style.transform = "";
        sheet.style.willChange = "";
        const dim = dims[index];
        if (dim) dim.style.opacity = "";
      });
    },
  };
}

/** Strip height limits in px; `narrowMin` applies when cards stack their name over their cohort. */
interface FileOptions {
  min: number;
  narrowMin: number;
  max: number;
}

/**
 * A stack of CSS-sticky items inside a section (builders, principles). As an
 * item slides over the one before, that one settles back; an item that has
 * risen into the upper part of the screen is marked `is-landed`.
 *
 * With `file`, the list is a card file: each covered card leaves a strip
 * (its name) showing above the next. The strip height and the gap between
 * cards are sized to the screen, so every card stays fully readable for at
 * least half a screen of scrolling before the next one covers it, without
 * padding the page with empty scroll.
 */
export function cardStackScene(
  list: HTMLElement,
  options: { recede: string; scale?: number; dim?: number; file?: FileOptions },
): Scene {
  const items = [...list.querySelectorAll<HTMLElement>(":scope > li")];
  const targets = items.map((item) => item.querySelector<HTMLElement>(options.recede) ?? item);
  const dims = items.map((item) => item.querySelector<HTMLElement>("[data-hb-dim]"));
  const sticks = items.map(() => 0);
  const tops = items.map(() => 0);
  const visible = items.map(() => true);
  let sticky = false;
  let vh = window.innerHeight;
  const depth = options.scale ?? 0.05;
  const dimMax = options.dim ?? 0.55;

  function sizeFile(file: FileOptions) {
    const shown = items.filter((_, index) => visible[index]);
    const count = shown.length;
    if (count < 3) return;
    const first = Number.parseFloat(getComputedStyle(shown[0]).top) || 0;
    const tallest = Math.max(...shown.map((item) => item.offsetHeight));
    // Each card must stay readable for at least ~46% of a screen of scrolling
    // between arriving whole and being covered by the next; the second-to-last
    // card, which sticks lowest, has the least room.
    const room = vh * 0.54 - first - tallest + 24;
    const min = list.offsetWidth >= 640 ? file.min : file.narrowMin;
    const strip = Math.min(file.max, Math.max(min, room / (count - 2)));
    const gap = Math.max(16, (count - 2) * strip - room + 16);
    list.style.setProperty("--hb-strip", `${Math.round(strip)}px`);
    list.style.setProperty("--hb-gap", `${Math.round(gap)}px`);
  }

  return {
    measure() {
      vh = window.innerHeight;
      sticky = items.length > 1 && getComputedStyle(items[0]).position === "sticky";
      items.forEach((item, index) => {
        visible[index] = item.offsetHeight > 0;
      });
      if (sticky && options.file) sizeFile(options.file);
      items.forEach((item, index) => {
        sticks[index] = Number.parseFloat(getComputedStyle(item).top) || 0;
      });
    },
    read() {
      if (!sticky) return;
      items.forEach((item, index) => {
        if (visible[index]) tops[index] = item.getBoundingClientRect().top;
      });
    },
    write() {
      if (!sticky) return;
      items.forEach((item, index) => {
        if (!visible[index]) return;
        // "Landed" once it reaches its reading position in the upper part of the screen.
        item.classList.toggle("is-landed", tops[index] <= Math.max(sticks[index] + 6, vh * 0.42));
        let next = index + 1;
        while (next < items.length && !visible[next]) next += 1;
        const p = next < items.length ? clamp01((vh - tops[next]) / (vh - sticks[next])) : 0;
        targets[index].style.transform = p > 0 ? `scale(${(1 - depth * p).toFixed(4)})` : "";
        const dim = dims[index];
        if (dim) dim.style.opacity = (dimMax * p * p).toFixed(3);
      });
    },
    destroy() {
      list.style.removeProperty("--hb-strip");
      list.style.removeProperty("--hb-gap");
      items.forEach((item, index) => {
        item.classList.remove("is-landed");
        targets[index].style.transform = "";
        const dim = dims[index];
        if (dim) dim.style.opacity = "";
      });
    },
  };
}
